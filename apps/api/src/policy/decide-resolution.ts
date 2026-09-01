/** Compose deterministic support, executable planning, risk flags, and policy gates. */
import type { InvestigationOutcome } from "../agent/schema.js";
import type { ExceptionRecord } from "../db/schema.js";
import { buildActionPlan, type ActionPlanResult } from "./action-plan.js";
import { verifyDeterministicSupport, type DeterministicSupportResult } from "./deterministic-support.js";
import { evaluateResolutionPolicy, type ResolutionPolicyDecision, type ResolutionPolicyInput } from "./resolution-policy.js";

export interface DecideResolutionInput {
  exception: ExceptionRecord;
  outcome: InvestigationOutcome;
  additionalHighRiskFlags?: string[];
  config?: ResolutionPolicyInput["config"];
}

export interface ResolutionDecisionBundle {
  support: DeterministicSupportResult | null;
  actionPlan: ActionPlanResult | null;
  policy: ResolutionPolicyDecision;
}

function deriveHighRiskFlags(exception: ExceptionRecord, additional: string[]): string[] {
  const flags = [...additional];
  if (exception.severity === "high") flags.push("HIGH_SEVERITY");
  if (exception.status !== "OPEN") flags.push("EXCEPTION_NOT_OPEN");
  if (exception.resolvedAt !== null) flags.push("ALREADY_RESOLVED");
  return [...new Set(flags)].sort();
}

export function decideResolution(input: DecideResolutionInput): ResolutionDecisionBundle {
  const result = input.outcome.status === "completed" ? input.outcome.result : null;
  const support = result ? verifyDeterministicSupport(input.exception, result) : null;
  const actionPlan = result ? buildActionPlan(input.exception, result) : null;
  const policy = evaluateResolutionPolicy({
    exceptionId: input.exception.id,
    amountAtRiskPaise: input.exception.amountAtRiskPaise,
    outcome: input.outcome,
    deterministicEvidenceSupportsClaim: support?.supported ?? false,
    actionExecutionReady: actionPlan?.ready ?? false,
    highRiskFlags: deriveHighRiskFlags(input.exception, input.additionalHighRiskFlags ?? []),
    config: input.config,
  });
  return { support, actionPlan, policy };
}
