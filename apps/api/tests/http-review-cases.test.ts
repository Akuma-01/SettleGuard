import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db/client.js";
import { bankTransactions, batches, exceptions, investigations, merchants, reconciliationRuns, reviewCases, settlements } from "../src/db/schema.js";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance;
let approvalReviewId: number;
let rejectionReviewId: number;
let unresolvedReviewId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "HTTP Review Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `http-reviews-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
  }).returning();
  const [run] = await db.insert(reconciliationRuns).values({ batchId: batch!.id, status: "completed" }).returning();
  const [settlement] = await db.insert(settlements).values({
    batchId: batch!.id,
    externalSettlementId: "http-review-settlement",
    grossAmountPaise: 10_000,
    feeAmountPaise: 200,
    taxAmountPaise: 36,
    reportedNetPaise: 9_764,
    bankReference: "RIGHT-REF",
  }).returning();
  const [bank] = await db.insert(bankTransactions).values({
    batchId: batch!.id,
    externalBankId: "http-review-bank",
    amountPaise: 9_764,
    direction: "credit",
    postedAt: new Date(),
    reference: "WRONG-REF",
  }).returning();
  const createdExceptions = await db.insert(exceptions).values([
    {
      runId: run!.id,
      type: "AMBIGUOUS_MATCH",
      severity: "medium",
      status: "OPEN",
      amountAtRiskPaise: 9_764,
      primaryRecordType: "settlement",
      primaryRecordId: settlement!.id,
      deterministicEvidenceJson: {
        bankTransactionId: bank!.id,
        settlementId: settlement!.id,
        bankReference: "WRONG-REF",
        settlementBankReference: "RIGHT-REF",
      },
    },
    { runId: run!.id, type: "FEE_MISMATCH", severity: "medium", status: "OPEN", amountAtRiskPaise: 500 },
    { runId: run!.id, type: "UNKNOWN_ADJUSTMENT", severity: "medium", status: "OPEN", amountAtRiskPaise: 700 },
  ]).returning();
  await db.insert(investigations).values({
    exceptionId: createdExceptions[0]!.id,
    status: "completed",
    recommendedAction: "link_record",
    structuredOutputJson: {
      exceptionId: createdExceptions[0]!.id,
      rootCause: "ambiguous_match",
      confidence: 0.99,
      evidence: [{ recordId: `settlement:${settlement!.id}`, reason: "The bank credit is the deterministic candidate." }],
      recommendedAction: "link_record",
      requiresHumanApproval: true,
      explanation: "A human must approve the ambiguous link.",
    },
  });
  const reviews = await db.insert(reviewCases).values([
    { exceptionId: createdExceptions[0]!.id, status: "pending", proposedAction: "link_record" },
    { exceptionId: createdExceptions[1]!.id, status: "pending", proposedAction: "rerun_reconciliation" },
    { exceptionId: createdExceptions[2]!.id, status: "pending", proposedAction: "manual_investigation_required" },
  ]).returning();
  approvalReviewId = reviews[0]!.id;
  rejectionReviewId = reviews[1]!.id;
  unresolvedReviewId = reviews[2]!.id;
  app = buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("review-case HTTP actions", () => {
  const reviewer = { reviewerId: "reviewer-http-1", note: "Verified against the bank statement." };

  it("approves and executes a validated deterministic link", async () => {
    const response = await app.inject({ method: "POST", url: `/api/review-cases/${approvalReviewId}/approve`, payload: reviewer });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ review: { status: "linked", created: true, exceptionResolved: true } });

    const retry = await app.inject({ method: "POST", url: `/api/review-cases/${approvalReviewId}/approve`, payload: reviewer });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ review: { status: "already_approved" } });
  });

  it("rejects a proposal while preserving its exception", async () => {
    const response = await app.inject({ method: "POST", url: `/api/review-cases/${rejectionReviewId}/reject`, payload: reviewer });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ review: { decision: "reject", applied: true, exceptionStatus: "OPEN" } });
  });

  it("supports the explicit mark-unresolved disposition", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/review-cases/${unresolvedReviewId}/reject`,
      payload: { ...reviewer, decision: "mark_unresolved" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ review: { decision: "mark_unresolved", exceptionStatus: "UNRESOLVED" } });
  });

  it("returns stable validation and not-found errors", async () => {
    const invalid = await app.inject({ method: "POST", url: "/api/review-cases/nope/approve", payload: reviewer });
    expect(invalid.statusCode).toBe(400);
    const invalidBody = await app.inject({ method: "POST", url: `/api/review-cases/${approvalReviewId}/reject`, payload: {} });
    expect(invalidBody.statusCode).toBe(400);
    const missing = await app.inject({ method: "POST", url: "/api/review-cases/2147483647/reject", payload: reviewer });
    expect(missing.statusCode).toBe(404);
  });
});
