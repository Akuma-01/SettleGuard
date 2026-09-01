import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REGRESSION_EXPECTATIONS, runDatabaseAgentRegression } from "../src/agent/regression-cases.js";
import type { ModelCaller, ModelResponse } from "../src/agent/loop.js";
import { db } from "../src/db/client.js";
import { exceptions, reconciliationRuns } from "../src/db/schema.js";

const outputDirectory = path.join("/tmp", `settleguard-agent-regression-${process.pid}`);
let completeRunId: number;

beforeAll(async () => {
  const runs = await db.select({ id: reconciliationRuns.id }).from(reconciliationRuns).orderBy(desc(reconciliationRuns.id));
  for (const run of runs) {
    const rows = await db.select({ type: exceptions.type }).from(exceptions).where(eq(exceptions.runId, run.id));
    const types = new Set(rows.map((row) => row.type));
    if (REGRESSION_EXPECTATIONS.every((expectation) => types.has(expectation.type))) {
      completeRunId = run.id;
      return;
    }
  }
  throw new Error("Run the benchmark once before the agent regression integration test.");
});

afterAll(async () => {
  await rm(outputDirectory, { recursive: true, force: true });
});

const expectedByType: Record<string, { rootCause: string; recommendedAction: string }> = {
  MISSING_SETTLEMENT: { rootCause: "timing_difference", recommendedAction: "rerun_reconciliation" },
  FEE_MISMATCH: { rootCause: "fee_mismatch", recommendedAction: "create_review_case" },
  UNKNOWN_ADJUSTMENT: { rootCause: "insufficient_evidence", recommendedAction: "no_action" },
  DUPLICATE_REFUND: { rootCause: "duplicate_refund", recommendedAction: "create_review_case" },
  BANK_CREDIT_MISMATCH: { rootCause: "other", recommendedAction: "create_review_case" },
  AMBIGUOUS_MATCH: { rootCause: "ambiguous_match", recommendedAction: "create_review_case" },
};

const scriptedModel: ModelCaller = async ({ messages }): Promise<ModelResponse> => {
  const initial = messages[0]?.content;
  if (typeof initial !== "string") throw new Error("Expected the initial investigation message");
  const exceptionId = Number(initial.match(/exception #(\d+)/i)?.[1]);
  const exceptionType = initial.match(/Type: ([A-Z_]+)/)?.[1] ?? "";
  const expectation = expectedByType[exceptionType];
  if (!exceptionId || !expectation) throw new Error(`Unsupported scripted case: ${exceptionType}`);

  return {
    stop_reason: "end_turn",
    content: [{
      type: "text",
      text: JSON.stringify({
        exceptionId,
        rootCause: expectation.rootCause,
        confidence: exceptionType === "UNKNOWN_ADJUSTMENT" ? 0.35 : 0.98,
        evidence: [{ recordId: `exception:${exceptionId}`, reason: "Cited from deterministic exception context for pipeline verification." }],
        recommendedAction: expectation.recommendedAction,
        requiresHumanApproval: true,
        explanation: "Scripted regression response used to verify the full multi-class pipeline without claiming live-model quality.",
      }),
    }],
  };
};

describe("runDatabaseAgentRegression — scripted six-class integration", () => {
  it("runs every real exception class through investigation, scoring, and evidence rendering", async () => {
    const summary = await runDatabaseAgentRegression(completeRunId, scriptedModel, outputDirectory);

    if (summary.failed > 0) {
      throw new Error(JSON.stringify(summary.results.map((result) => ({ type: result.case.exceptionType, failures: result.failures, outcome: result.outcome })), null, 2));
    }
    expect(summary).toMatchObject({ total: 6, passed: 6, failed: 0, passRate: 1, aiErrorCount: 0, unsafeResolutionCount: 0 });
    expect(summary.results.map((result) => result.case.exceptionType)).toEqual(REGRESSION_EXPECTATIONS.map((expectation) => expectation.type));
    const files = await readdir(outputDirectory);
    expect(files.filter((file) => file.endsWith(".html"))).toHaveLength(6);
  });
});
