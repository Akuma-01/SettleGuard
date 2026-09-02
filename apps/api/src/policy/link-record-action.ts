/** Human-authorized resolution action for an ambiguous bank-to-settlement link. */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditLogs, bankTransactions, exceptions, matches, reconciliationRuns, reviewCases, settlements } from "../db/schema.js";
import type { ExecutableActionPlan } from "./action-plan.js";

type LinkRecordPlan = Extract<ExecutableActionPlan, { action: "link_record" }>;

export interface LinkRecordAuthorization {
  actorType: "human";
  actorId: string;
  reason: string;
  reviewCaseId?: number;
  reviewerNote?: string;
}

export type LinkRecordActionResult =
  | { status: "denied"; reason: "HUMAN_AUTHORIZATION_REQUIRED" }
  | { status: "linked"; matchId: number; created: boolean; exceptionResolved: boolean };

function evidenceObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function executeLinkRecordAction(
  plan: LinkRecordPlan,
  authorization?: LinkRecordAuthorization,
): Promise<LinkRecordActionResult> {
  if (!authorization || !authorization.actorId.trim() || !authorization.reason.trim()) {
    return { status: "denied", reason: "HUMAN_AUTHORIZATION_REQUIRED" };
  }

  const [[exception], [bankTransaction], [settlement]] = await Promise.all([
    db.select().from(exceptions).where(eq(exceptions.id, plan.exceptionId)),
    db.select().from(bankTransactions).where(eq(bankTransactions.id, plan.sourceId)),
    db.select().from(settlements).where(eq(settlements.id, plan.targetId)),
  ]);
  if (!exception) throw new Error(`No exception with id ${plan.exceptionId}`);
  const [reviewCase] = authorization.reviewCaseId
    ? await db.select().from(reviewCases).where(eq(reviewCases.id, authorization.reviewCaseId))
    : [undefined];
  if (authorization.reviewCaseId && (!reviewCase || reviewCase.exceptionId !== exception.id || reviewCase.status !== "pending")) {
    throw new Error("Link approval requires a pending review case for this exception");
  }
  if (reviewCase && (!authorization.reviewerNote || !authorization.reviewerNote.trim())) {
    throw new Error("Link approval requires a reviewer note");
  }
  const [trustedRun] = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, exception.runId));
  if (!trustedRun) throw new Error(`No reconciliation run with id ${exception.runId}`);
  if (exception.type !== "AMBIGUOUS_MATCH") throw new Error("link_record requires an AMBIGUOUS_MATCH exception");
  if (plan.sourceType !== "bank_transaction" || plan.targetType !== "settlement") throw new Error("Unsupported link record types");
  if (!bankTransaction || !settlement) throw new Error("Link source or target record does not exist");
  if (bankTransaction.batchId !== trustedRun.batchId || settlement.batchId !== trustedRun.batchId) {
    throw new Error("Link source and target must belong to the exception batch");
  }

  const evidence = evidenceObject(exception.deterministicEvidenceJson);
  if (evidence.bankTransactionId !== plan.sourceId || evidence.settlementId !== plan.targetId) {
    throw new Error("Link parameters do not match deterministic exception evidence");
  }

  const existing = await db.select().from(matches).where(and(
    eq(matches.runId, exception.runId),
    eq(matches.sourceType, plan.sourceType),
    eq(matches.sourceId, plan.sourceId),
  ));
  const exact = existing.find((match) => match.targetType === plan.targetType && match.targetId === plan.targetId);
  if (existing.length > 0 && !exact) throw new Error("Bank transaction is already linked to a different settlement");
  if (exact && exception.status !== "OPEN") {
    return { status: "linked", matchId: exact.id, created: false, exceptionResolved: false };
  }

  return db.transaction(async (tx) => {
    let matchId = exact?.id;
    if (!matchId) {
      const [created] = await tx.insert(matches).values({
        runId: exception.runId,
        sourceType: plan.sourceType,
        sourceId: plan.sourceId,
        targetType: plan.targetType,
        targetId: plan.targetId,
        matchType: "human_review",
        score: 100,
        status: "matched",
        evidenceJson: { via: "approved_resolution", exceptionId: exception.id },
      }).returning({ id: matches.id });
      matchId = created!.id;
    }

    const updated = await tx.update(exceptions)
      .set({ status: "HUMAN_RESOLVED", resolvedAt: new Date() })
      .where(and(eq(exceptions.id, exception.id), eq(exceptions.status, "OPEN")))
      .returning({ id: exceptions.id });
    if (updated.length !== 1) throw new Error(`Exception ${exception.id} changed while link resolution was executing`);

    if (reviewCase) {
      const closed = await tx.update(reviewCases).set({
        status: "completed",
        reviewerDecision: "approve",
        reviewerNote: authorization.reviewerNote!.trim(),
        reviewedAt: new Date(),
      }).where(and(eq(reviewCases.id, reviewCase.id), eq(reviewCases.status, "pending"))).returning({ id: reviewCases.id });
      if (closed.length !== 1) throw new Error(`Review case ${reviewCase.id} changed while link resolution was executing`);
    }

    await tx.insert(auditLogs).values({
      actorType: authorization.actorType,
      actorId: authorization.actorId,
      action: "link_record",
      entityType: "exception",
      entityId: exception.id,
      beforeJson: { status: exception.status, resolvedAt: exception.resolvedAt },
      afterJson: { status: "HUMAN_RESOLVED", matchId },
      metadataJson: { authorizationReason: authorization.reason, reviewCaseId: reviewCase?.id ?? null, plan },
    });
    if (reviewCase) {
      await tx.insert(auditLogs).values({
        actorType: "human",
        actorId: authorization.actorId,
        action: "review_approve",
        entityType: "review_case",
        entityId: reviewCase.id,
        beforeJson: { status: reviewCase.status },
        afterJson: { status: "completed", reviewerDecision: "approve", exceptionStatus: "HUMAN_RESOLVED", matchId },
        metadataJson: { exceptionId: exception.id, note: authorization.reviewerNote },
      });
    }
    return { status: "linked", matchId, created: !exact, exceptionResolved: true };
  });
}
