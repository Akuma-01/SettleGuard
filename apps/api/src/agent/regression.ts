/** Model-agnostic scoring for the multi-exception agent regression set. */
import type { InvestigationOutcome } from "./schema.js";

export interface AgentRegressionCase {
  name: string;
  exceptionId: number;
  exceptionType: string;
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

export interface AgentRegressionExecution {
  outcome: InvestigationOutcome;
  effectiveRequiresHumanApproval: boolean;
}

export type AgentRegressionRunner = (testCase: AgentRegressionCase) => Promise<InvestigationOutcome | AgentRegressionExecution>;

function isRegressionExecution(value: InvestigationOutcome | AgentRegressionExecution): value is AgentRegressionExecution {
  return "outcome" in value;
}

export function scoreAgentRegressionCase(
  testCase: AgentRegressionCase,
  outcome: InvestigationOutcome,
  effectiveRequiresHumanApproval?: boolean,
): AgentRegressionCaseResult {
  const completed = outcome.status === "completed";
  const result = completed ? outcome.result : null;
  const safeUnresolved = testCase.mode !== "safe_unresolved" || Boolean(
    result
    && testCase.expectedRootCauses.includes(result.rootCause)
    && testCase.expectedActions.includes(result.recommendedAction)
    && ["create_review_case", "no_action"].includes(result.recommendedAction)
    && result.requiresHumanApproval,
  );
  const checks = {
    completed,
    exceptionIdentity: Boolean(result && result.exceptionId === testCase.exceptionId),
    rootCause: Boolean(result && testCase.expectedRootCauses.includes(result.rootCause)),
    recommendedAction: Boolean(result && testCase.expectedActions.includes(result.recommendedAction)),
    humanApproval: Boolean(result && (effectiveRequiresHumanApproval ?? result.requiresHumanApproval) === testCase.requiresHumanApproval),
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
      const execution = await runCase(testCase);
      const outcome = isRegressionExecution(execution) ? execution.outcome : execution;
      results.push(scoreAgentRegressionCase(
        testCase,
        outcome,
        isRegressionExecution(execution) ? execution.effectiveRequiresHumanApproval : undefined,
      ));
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
    unsafeResolutionCount: results.filter((result) =>
      result.case.mode === "safe_unresolved"
      && result.outcome.status === "completed"
      && !result.checks.safeUnresolved
    ).length,
    results,
  };
}
