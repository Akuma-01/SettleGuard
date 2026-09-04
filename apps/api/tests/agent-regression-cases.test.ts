import { desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAgentRegressionCases, REGRESSION_EXPECTATIONS } from "../src/agent/regression-cases.js";
import { db } from "../src/db/client.js";
import { exceptions, reconciliationRuns } from "../src/db/schema.js";

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
  throw new Error("Run the benchmark once before the agent regression case tests.");
});

describe("buildAgentRegressionCases", () => {
  it("selects one real exception from every deterministic MVP class", async () => {
    const cases = await buildAgentRegressionCases(completeRunId);
    expect(cases).toHaveLength(6);
    expect(cases.map((testCase) => testCase.exceptionType)).toEqual(REGRESSION_EXPECTATIONS.map((expectation) => expectation.type));
    expect(new Set(cases.map((testCase) => testCase.exceptionId)).size).toBe(6);
  });

  it("marks non-mutating review scenarios as safe-unresolved", async () => {
    const cases = await buildAgentRegressionCases(completeRunId);
    expect(cases.find((testCase) => testCase.exceptionType === "UNKNOWN_ADJUSTMENT")).toMatchObject({
      exceptionType: "UNKNOWN_ADJUSTMENT",
      mode: "safe_unresolved",
      expectedRootCauses: ["unknown_adjustment", "insufficient_evidence"],
      expectedActions: ["create_review_case", "no_action"],
      requiresHumanApproval: true,
    });
    expect(cases.find((testCase) => testCase.exceptionType === "AMBIGUOUS_MATCH")).toMatchObject({ mode: "safe_unresolved" });
  });

  it("rejects invalid or incomplete reconciliation runs clearly", async () => {
    await expect(buildAgentRegressionCases(0)).rejects.toThrow(/positive integer/);
    await expect(buildAgentRegressionCases(999_999_999)).rejects.toThrow(/missing exception types/);
  });
});
