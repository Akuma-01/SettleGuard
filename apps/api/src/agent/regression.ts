/** Model-agnostic scoring for Day 8's multi-exception agent regression set. */
import type { InvestigationOutcome } from "./schema.js";

export interface AgentRegressionCase {
  name: string;
  exceptionId: number;
  expectedRootCauses: string[];
  expectedActions: string[];
  requiresHumanApproval: boolean;
  mode?: "classification" | "safe_unresolved";
}

export interface AgentRegressionCaseResult {
  case: AgentRegressionCase;
  outcome: InvestigationOutcome;
  passed: boolean;
  checks: {
    completed: boolean;
    exceptionIdentity: boolean;
    rootCause: boolean;
    recommendedAction: boolean;
    humanApproval: boolean;
    safeUnresolved: boolean;
  };
  failures: string[];
}

export interface AgentRegressionSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  aiErrorCount: number;
  unsafeResolutionCount: number;
  results: AgentRegressionCaseResult[];
}

export type AgentRegressionRunner = (testCase: AgentRegressionCase) => Promise<InvestigationOutcome>;

export function scoreAgentRegressionCase(testCase: AgentRegressionCase, outcome: InvestigationOutcome): AgentRegressionCaseResult {
  const completed = outcome.status === "completed";
  const result = completed ? outcome.result : null;
  const safeUnresolved = testCase.mode !== "safe_unresolved" || Boolean(
    result
    && result.rootCause === "insufficient_evidence"
    && result.recommendedAction === "no_action"
    && result.requiresHumanApproval,
  );
  const checks = {
    completed,
    exceptionIdentity: Boolean(result && result.exceptionId === testCase.exceptionId),
    rootCause: Boolean(result && testCase.expectedRootCauses.includes(result.rootCause)),
    recommendedAction: Boolean(result && testCase.expectedActions.includes(result.recommendedAction)),
    humanApproval: Boolean(result && result.requiresHumanApproval === testCase.requiresHumanApproval),
    safeUnresolved,
  };
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return { case: testCase, outcome, passed: failures.length === 0, checks, failures };
}

export async function runAgentRegression(
  cases: AgentRegressionCase[],
  runCase: AgentRegressionRunner,
): Promise<AgentRegressionSummary> {
  const results: AgentRegressionCaseResult[] = [];
  for (const testCase of cases) {
    try {
      const outcome = await runCase(testCase);
      results.push(scoreAgentRegressionCase(testCase, outcome));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push(scoreAgentRegressionCase(testCase, { status: "ai_error", reason: `Regression runner failed: ${reason}`, rawResponse: "" }));
    }
  }
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 1 : passed / results.length,
    aiErrorCount: results.filter((result) => result.outcome.status === "ai_error").length,
    unsafeResolutionCount: results.filter((result) => result.case.mode === "safe_unresolved" && !result.checks.safeUnresolved).length,
    results,
  };
}
