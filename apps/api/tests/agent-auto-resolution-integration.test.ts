import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { investigateException } from "../src/agent/investigate.js";
import type { ModelCaller } from "../src/agent/loop.js";
import { db } from "../src/db/client.js";
import { batches, exceptions, merchants, reconciliationRuns } from "../src/db/schema.js";

let exceptionId: number;
let reviewExceptionId: number;
let unresolvedExceptionId: number;
let originalRunId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "Auto Resolution Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `agent-auto-resolution-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
    recordCount: 0,
  }).returning();
  const [run] = await db.insert(reconciliationRuns).values({ batchId: batch!.id, status: "completed" }).returning();
  originalRunId = run!.id;
  const [exception] = await db.insert(exceptions).values({
    runId: run!.id,
    type: "FEE_MISMATCH",
    severity: "medium",
    status: "OPEN",
    amountAtRiskPaise: 500,
    primaryRecordType: "settlement",
    primaryRecordId: 999_998,
    summary: "Synthetic exception that clears on an empty-batch rerun",
    deterministicEvidenceJson: {
      settlementId: 999_998,
      correctFeePaise: 100,
      reportedFeePaise: 120,
      correctTaxPaise: 18,
      reportedTaxPaise: 22,
    },
  }).returning();
  exceptionId = exception!.id;

  const reviewExceptions = await db.insert(exceptions).values([
    {
      runId: originalRunId,
      type: "FEE_MISMATCH",
      severity: "medium",
      status: "OPEN",
      amountAtRiskPaise: 500,
      primaryRecordType: "settlement",
      primaryRecordId: 999_997,
      summary: "Synthetic low-confidence review exception",
      deterministicEvidenceJson: {},
    },
    {
      runId: originalRunId,
      type: "UNKNOWN_ADJUSTMENT",
      severity: "medium",
      status: "OPEN",
      amountAtRiskPaise: 500,
      primaryRecordType: "adjustment",
      primaryRecordId: 999_996,
      summary: "Synthetic unresolved exception",
      deterministicEvidenceJson: {},
    },
  ]).returning();
  reviewExceptionId = reviewExceptions[0]!.id;
  unresolvedExceptionId = reviewExceptions[1]!.id;
});

describe("investigation auto-resolution", () => {
  const outputPath = path.resolve("/tmp", "test-auto-resolution-evidence.html");

  it("executes an eligible rerun and reports resolution only after deterministic clearance", async () => {
    const callModel: ModelCaller = async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          exceptionId,
          rootCause: "fee_mismatch",
          confidence: 0.99,
          evidence: [{ recordId: "settlement:999998", reason: "The deterministic fee and tax values differ." }],
          recommendedAction: "rerun_reconciliation",
          requiresHumanApproval: false,
          explanation: "Rerun reconciliation using the verified fee inputs.",
        }),
      }],
      stop_reason: "end_turn",
    });

    const summary = await investigateException(exceptionId, callModel, outputPath);

    expect(summary.resolutionDecision.policy.decision).toBe("auto_resolve");
    expect(summary.resolutionExecution).toMatchObject({
      status: "executed",
      result: { status: "executed", resolved: true, assessment: { outcome: "cleared" } },
    });
    expect(summary.policyDecision).toMatch(/Auto-resolved after reconciliation run/);
    const [resolved] = await db.select().from(exceptions).where(eq(exceptions.id, exceptionId));
    expect(resolved).toMatchObject({ status: "AUTO_RESOLVED" });
    expect(resolved!.resolvedAt).toBeInstanceOf(Date);
  });

  it("counts review and unresolved dispositions once even when an investigation is repeated", async () => {
    const reviewCaller: ModelCaller = async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          exceptionId: reviewExceptionId,
          rootCause: "fee_mismatch",
          confidence: 0.5,
          evidence: [{ recordId: "settlement:999997", reason: "The fee mismatch requires source verification." }],
          recommendedAction: "create_review_case",
          requiresHumanApproval: true,
          explanation: "A reviewer should verify the source fee schedule.",
        }),
      }],
      stop_reason: "end_turn",
    });
    await investigateException(reviewExceptionId, reviewCaller, path.resolve("/tmp", "test-review-metric-evidence.html"));
    await investigateException(reviewExceptionId, reviewCaller, path.resolve("/tmp", "test-review-metric-evidence.html"));

    const invalidCaller: ModelCaller = async () => ({
      content: [{ type: "text", text: "not valid JSON" }],
      stop_reason: "end_turn",
    });
    await investigateException(unresolvedExceptionId, invalidCaller, path.resolve("/tmp", "test-unresolved-metric-evidence.html"));

    const [run] = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, originalRunId));
    expect(run).toMatchObject({ autoResolvedCount: 1, humanReviewCount: 1, unresolvedCount: 1 });
  });

  it("cleanup", () => {
    for (const file of [outputPath, "/tmp/test-review-metric-evidence.html", "/tmp/test-unresolved-metric-evidence.html"]) {
      if (existsSync(file)) unlinkSync(file);
    }
  });
});
