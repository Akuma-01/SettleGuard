import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { auditLogs, batches, exceptions, merchants, reconciliationRuns, reviewCases } from "../src/db/schema.js";
import { decideReviewCase } from "../src/policy/review-decision.js";

let rejectedReviewId: number;
let rejectedExceptionId: number;
let unresolvedReviewId: number;
let unresolvedExceptionId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "Review Decision Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `review-decision-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
  }).returning();
  const [run] = await db.insert(reconciliationRuns).values({ batchId: batch!.id, status: "completed" }).returning();
  const createdExceptions = await db.insert(exceptions).values([
    { runId: run!.id, type: "FEE_MISMATCH", severity: "medium", status: "OPEN", amountAtRiskPaise: 500 },
    { runId: run!.id, type: "UNKNOWN_ADJUSTMENT", severity: "medium", status: "OPEN", amountAtRiskPaise: 700 },
  ]).returning();
  rejectedExceptionId = createdExceptions[0]!.id;
  unresolvedExceptionId = createdExceptions[1]!.id;
  const reviews = await db.insert(reviewCases).values([
    { exceptionId: rejectedExceptionId, status: "pending", proposedAction: "rerun_reconciliation" },
    { exceptionId: unresolvedExceptionId, status: "pending", proposedAction: "manual_investigation_required" },
  ]).returning();
  rejectedReviewId = reviews[0]!.id;
  unresolvedReviewId = reviews[1]!.id;
});

describe("decideReviewCase", () => {
  it("rejects a proposal without hiding or resolving the exception", async () => {
    const result = await decideReviewCase(rejectedReviewId, {
      decision: "reject",
      reviewerId: "reviewer-1",
      note: "The proposed rerun does not address the source discrepancy.",
    });

    expect(result).toEqual({
      reviewCaseId: rejectedReviewId,
      exceptionId: rejectedExceptionId,
      decision: "reject",
      applied: true,
      exceptionStatus: "OPEN",
    });
    const [review] = await db.select().from(reviewCases).where(eq(reviewCases.id, rejectedReviewId));
    expect(review).toMatchObject({ status: "rejected", reviewerDecision: "reject", reviewerNote: result.applied ? expect.any(String) : null });
  });

  it("makes an exact retry idempotent but rejects a conflicting decision", async () => {
    const input = { decision: "reject" as const, reviewerId: "reviewer-1", note: "The proposed rerun does not address the source discrepancy." };
    await expect(decideReviewCase(rejectedReviewId, input)).resolves.toMatchObject({ applied: false, decision: "reject" });
    await expect(decideReviewCase(rejectedReviewId, { ...input, decision: "mark_unresolved" })).rejects.toThrow(/already been decided/);
  });

  it("marks an exception explicitly unresolved and audits the reviewer", async () => {
    const result = await decideReviewCase(unresolvedReviewId, {
      decision: "mark_unresolved",
      reviewerId: "reviewer-2",
      note: "Source documentation is unavailable; preserve this for reporting.",
    });
    expect(result).toMatchObject({ applied: true, exceptionStatus: "UNRESOLVED" });
    const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, unresolvedExceptionId));
    expect(exception).toMatchObject({ status: "UNRESOLVED", resolvedAt: null });
    const [audit] = await db.select().from(auditLogs).where(and(
      eq(auditLogs.entityType, "review_case"),
      eq(auditLogs.entityId, unresolvedReviewId),
      eq(auditLogs.action, "review_mark_unresolved"),
    ));
    expect(audit).toMatchObject({ actorType: "human", actorId: "reviewer-2" });
    expect(audit!.afterJson).toMatchObject({ reviewStatus: "completed", exceptionStatus: "UNRESOLVED" });
  });

  it("rejects missing reviewer identity or rationale", async () => {
    await expect(decideReviewCase(1, { decision: "reject", reviewerId: "", note: "" })).rejects.toThrow(/Invalid review decision/);
  });
});
