/** Real-database case selection and execution for the agent regression set. */
import { eq } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { db } from "../db/client.js";
import { exceptions } from "../db/schema.js";
import { investigateException } from "./investigate.js";
import type { ModelCaller } from "./loop.js";
import { runAgentRegression, type AgentRegressionCase, type AgentRegressionSummary } from "./regression.js";

interface CaseExpectation {
  type: string;
  name: string;
  expectedRootCauses: string[];
  expectedActions: string[];
  mode?: "classification" | "safe_unresolved";
}

export const REGRESSION_EXPECTATIONS: CaseExpectation[] = [
  {
    type: "MISSING_SETTLEMENT",
    name: "captured payment missing from settlement",
    expectedRootCauses: ["missing_settlement"],
    expectedActions: ["rerun_reconciliation", "create_review_case", "no_action"],
  },
  {
    type: "FEE_MISMATCH",
    name: "deterministic fee mismatch",
    expectedRootCauses: ["fee_mismatch"],
    expectedActions: ["reclassify", "rerun_reconciliation", "create_review_case", "propose_adjustment"],
  },
  {
    type: "UNKNOWN_ADJUSTMENT",
    name: "unexplained adjustment remains safely unresolved",
    expectedRootCauses: ["unknown_adjustment", "insufficient_evidence"],
    expectedActions: ["create_review_case", "no_action"],
    mode: "safe_unresolved",
  },
  {
    type: "DUPLICATE_REFUND",
    name: "duplicate refund",
    expectedRootCauses: ["duplicate_refund"],
    expectedActions: ["link_record", "reclassify", "create_review_case"],
  },
  {
    type: "BANK_CREDIT_MISMATCH",
    name: "bank credit amount mismatch",
    expectedRootCauses: ["bank_credit_mismatch"],
    expectedActions: ["create_review_case", "propose_adjustment", "rerun_reconciliation"],
  },
  {
    type: "AMBIGUOUS_MATCH",
    name: "ambiguous settlement-bank match",
    expectedRootCauses: ["ambiguous_match", "insufficient_evidence"],
    expectedActions: ["link_record", "create_review_case", "no_action"],
    mode: "safe_unresolved",
  },
];

export async function buildAgentRegressionCases(runId: number): Promise<AgentRegressionCase[]> {
  if (!Number.isInteger(runId) || runId <= 0) throw new Error("runId must be a positive integer");
  const rows = await db.select().from(exceptions).where(eq(exceptions.runId, runId));
  const firstByType = new Map<string, (typeof rows)[number]>();
  for (const exception of rows) if (!firstByType.has(exception.type)) firstByType.set(exception.type, exception);

  const missingTypes = REGRESSION_EXPECTATIONS.filter((expectation) => !firstByType.has(expectation.type)).map((expectation) => expectation.type);
  if (missingTypes.length > 0) {
    throw new Error(`Reconciliation run ${runId} cannot provide the full regression set; missing exception types: ${missingTypes.join(", ")}`);
  }

  return REGRESSION_EXPECTATIONS.map((expectation) => ({
    name: expectation.name,
    exceptionId: firstByType.get(expectation.type)!.id,
    exceptionType: expectation.type,
    expectedRootCauses: expectation.expectedRootCauses,
    expectedActions: expectation.expectedActions,
    requiresHumanApproval: true,
    mode: expectation.mode,
  }));
}

export async function runDatabaseAgentRegression(
  runId: number,
  callModel: ModelCaller,
  outputDirectory: string,
): Promise<AgentRegressionSummary> {
  const cases = await buildAgentRegressionCases(runId);
  await mkdir(outputDirectory, { recursive: true });
  return runAgentRegression(cases, async (testCase) => {
    const outputPath = path.join(outputDirectory, `exception-${testCase.exceptionId}.html`);
    const investigation = await investigateException(testCase.exceptionId, callModel, outputPath);
    return {
      outcome: investigation.outcome,
      effectiveRequiresHumanApproval: investigation.policyDecision.includes("Review case"),
    };
  });
}
