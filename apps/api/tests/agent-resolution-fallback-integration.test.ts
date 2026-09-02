import { existsSync, unlinkSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { investigateException } from "../src/agent/investigate.js";
import type { ModelCaller } from "../src/agent/loop.js";
import { db } from "../src/db/client.js";
import { auditLogs, batches, exceptions, merchants, payments, reconciliationRuns, reviewCases, settlements } from "../src/db/schema.js";
import { runReconciliation } from "../src/reconciliation/run.js";

let persistentExceptionId: number;
let persistentSettlementId: number;
let failureExceptionId: number;
const persistentOutput = "/tmp/test-persistent-rerun-evidence.html";
const failureOutput = "/tmp/test-resolution-failure-evidence.html";

function feeMismatchCaller(exceptionId: number, settlementId: number): ModelCaller {
  return async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        exceptionId,
        rootCause: "fee_mismatch",
        confidence: 0.99,
        evidence: [{ recordId: `settlement:${settlementId}`, reason: "The deterministic fee calculation differs from the reported fee." }],
        recommendedAction: "rerun_reconciliation",
        requiresHumanApproval: false,
        explanation: "Rerun the deterministic reconciliation.",
      }),
    }],
    stop_reason: "end_turn",
  });
}

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "Resolution Fallback Test" }).returning();

  const [persistentBatch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `persistent-rerun-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
  }).returning();
  await db.insert(payments).values({
    batchId: persistentBatch!.id,
    externalPaymentId: "persistent-payment",
    amountPaise: 100_000,
    status: "captured",
    capturedAt: new Date("2026-09-01T10:00:00Z"),
  });
  const [settlement] = await db.insert(settlements).values({
    batchId: persistentBatch!.id,
    externalSettlementId: "persistent-settlement",
    grossAmountPaise: 100_000,
    feeAmountPaise: 2_100,
    taxAmountPaise: 378,
    adjustmentAmountPaise: 0,
    reportedNetPaise: 97_522,
    settledAt: new Date("2026-09-02T10:00:00Z"),
  }).returning();
  persistentSettlementId = settlement!.id;
  const original = await runReconciliation(persistentBatch!.id);
  const [persistent] = await db.select().from(exceptions).where(and(
    eq(exceptions.runId, original.runId),
    eq(exceptions.type, "FEE_MISMATCH"),
  ));
  persistentExceptionId = persistent!.id;

  const [failureBatch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `failed-resolution-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
  }).returning();
  const [failureRun] = await db.insert(reconciliationRuns).values({ batchId: failureBatch!.id, status: "completed" }).returning();
  const [failure] = await db.insert(exceptions).values({
    runId: failureRun!.id,
    type: "FEE_MISMATCH",
    severity: "medium",
    status: "OPEN",
    amountAtRiskPaise: 118,
    primaryRecordType: "settlement",
    primaryRecordId: 999_995,
    deterministicEvidenceJson: {
      settlementId: 999_995,
      correctFeePaise: 2_000,
      reportedFeePaise: 2_100,
      correctTaxPaise: 360,
      reportedTaxPaise: 378,
    },
  }).returning();
  failureExceptionId = failure!.id;
});

describe("investigation resolution fallback", () => {
  it("keeps a persistent rerun exception open and routes it to review", async () => {
    const summary = await investigateException(
      persistentExceptionId,
      feeMismatchCaller(persistentExceptionId, persistentSettlementId),
      persistentOutput,
    );

    expect(summary.resolutionExecution).toMatchObject({
      status: "executed",
      result: { resolved: false, assessment: { outcome: "persisted" } },
    });
    expect(summary.policyDecision).toContain("RERUN_PERSISTED");
    const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, persistentExceptionId));
    expect(exception).toMatchObject({ status: "OPEN", resolvedAt: null });
    const cases = await db.select().from(reviewCases).where(eq(reviewCases.exceptionId, persistentExceptionId));
    expect(cases).toHaveLength(1);
    const [actionAudit] = await db.select().from(auditLogs).where(and(
      eq(auditLogs.entityType, "exception"),
      eq(auditLogs.entityId, persistentExceptionId),
      eq(auditLogs.action, "rerun_reconciliation"),
    ));
    expect(actionAudit!.afterJson).toMatchObject({ status: "OPEN", assessment: { outcome: "persisted" } });
  });

  it("keeps execution failures open, creates review work, and audits the error", async () => {
    const summary = await investigateException(
      failureExceptionId,
      feeMismatchCaller(failureExceptionId, 999_995),
      failureOutput,
      async () => { throw new Error("simulated executor outage"); },
    );

    expect(summary.resolutionDecision.policy.decision).toBe("auto_resolve");
    expect(summary.resolutionExecution).toBeNull();
    expect(summary.policyDecision).toContain("simulated executor outage");
    const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, failureExceptionId));
    expect(exception).toMatchObject({ status: "OPEN", resolvedAt: null });
    const cases = await db.select().from(reviewCases).where(eq(reviewCases.exceptionId, failureExceptionId));
    expect(cases).toHaveLength(1);
    const [failureAudit] = await db.select().from(auditLogs).where(and(
      eq(auditLogs.entityType, "exception"),
      eq(auditLogs.entityId, failureExceptionId),
      eq(auditLogs.action, "resolution_action_failed"),
    ));
    expect(failureAudit!.afterJson).toEqual({ error: "simulated executor outage" });
  });

  it("cleanup", () => {
    for (const file of [persistentOutput, failureOutput]) if (existsSync(file)) unlinkSync(file);
  });
});
