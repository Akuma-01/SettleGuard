/** Fail-closed dispatch boundary for deterministic resolution actions. */
import type { InvestigationOutcome } from "../agent/schema.js";
import type { ExceptionRecord } from "../db/schema.js";
import { decideResolution, type ResolutionDecisionBundle } from "./decide-resolution.js";
import type { ExecutableActionPlan } from "./action-plan.js";
import type { ResolutionPolicyInput } from "./resolution-policy.js";

export interface ExecuteResolutionInput<TResult> {
  exception: ExceptionRecord;
  outcome: InvestigationOutcome;
  execute: (plan: ExecutableActionPlan) => Promise<TResult>;
  additionalHighRiskFlags?: string[];
  config?: ResolutionPolicyInput["config"];
}

export type ResolutionExecutionResult<TResult> =
  | {
      status: "denied";
      decision: ResolutionDecisionBundle;
    }
  | {
      status: "executed";
      decision: ResolutionDecisionBundle;
      plan: ExecutableActionPlan;
      result: TResult;
    };

/**
 * Recompute every gate from trusted exception state immediately before dispatch.
 * A model recommendation or previously cached decision can never authorize work.
 */
export async function executeResolution<TResult>(
  input: ExecuteResolutionInput<TResult>,
): Promise<ResolutionExecutionResult<TResult>> {
  const decision = decideResolution({
    exception: input.exception,
    outcome: input.outcome,
    additionalHighRiskFlags: input.additionalHighRiskFlags,
    config: input.config,
  });

  if (decision.policy.decision !== "auto_resolve" || !decision.actionPlan?.ready) {
    return { status: "denied", decision };
  }

  const plan = decision.actionPlan.plan;
  const result = await input.execute(plan);
  return { status: "executed", decision, plan, result };
}
