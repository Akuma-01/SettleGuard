/** Deterministic Phase 5 authorization policy. The model cannot override these gates. */
import type { InvestigationOutcome, InvestigationResult } from "../agent/schema.js";

export const DEFAULT_POLICY_CONFIG = {
  minimumAutoResolveConfidence: 0.95,
  maximumAutoResolveAmountPaise: 100_000,
} as const;

export type PolicyDecisionType = "auto_resolve" | "human_review" | "unresolved";

export type PolicyReasonCode =
  | "AI_ERROR"
  | "EXCEPTION_ID_MISMATCH"
  | "NO_ACTION_RECOMMENDED"
  | "INSUFFICIENT_EVIDENCE"
  | "AMBIGUOUS_MATCH"
  | "MODEL_REQUIRES_APPROVAL"
  | "LOW_CONFIDENCE"
  | "AMOUNT_OVER_LIMIT"
  | "HIGH_RISK_FLAG"
  | "DETERMINISTIC_SUPPORT_MISSING"
  | "ACTION_EXECUTION_NOT_READY"
  | "ACTION_NOT_REVERSIBLE"
  | "FINANCIAL_ADJUSTMENT_REQUIRES_REVIEW"
  | "REVIEW_REQUESTED"
  | "ALL_AUTO_RESOLVE_GATES_PASSED";

export interface ResolutionPolicyInput {
  exceptionId: number;
  amountAtRiskPaise: number;
  outcome: InvestigationOutcome;
  deterministicEvidenceSupportsClaim: boolean;
  actionExecutionReady: boolean;
  highRiskFlags?: string[];
  config?: {
    minimumAutoResolveConfidence: number;
    maximumAutoResolveAmountPaise: number;
  };
}

export interface ResolutionPolicyDecision {
  exceptionId: number;
  decision: PolicyDecisionType;
  recommendedAction: InvestigationResult["recommendedAction"] | null;
  reasons: PolicyReasonCode[];
  policySnapshot: {
    minimumAutoResolveConfidence: number;
    maximumAutoResolveAmountPaise: number;
    amountAtRiskPaise: number;
    confidence: number | null;
    deterministicEvidenceSupportsClaim: boolean;
    actionExecutionReady: boolean;
    highRiskFlags: string[];
  };
}

const reversibleActions = new Set<InvestigationResult["recommendedAction"]>([
  "link_record",
  "reclassify",
  "rerun_reconciliation",
]);

function validateInput(input: ResolutionPolicyInput) {
  if (!Number.isInteger(input.exceptionId) || input.exceptionId <= 0) throw new Error("exceptionId must be a positive integer");
  if (!Number.isInteger(input.amountAtRiskPaise) || input.amountAtRiskPaise < 0) throw new Error("amountAtRiskPaise must be a non-negative integer");
  if (typeof input.actionExecutionReady !== "boolean") throw new Error("actionExecutionReady must be a boolean");
  const config = input.config ?? DEFAULT_POLICY_CONFIG;
  if (config.minimumAutoResolveConfidence < 0 || config.minimumAutoResolveConfidence > 1) throw new Error("minimumAutoResolveConfidence must be between 0 and 1");
  if (!Number.isInteger(config.maximumAutoResolveAmountPaise) || config.maximumAutoResolveAmountPaise < 0) throw new Error("maximumAutoResolveAmountPaise must be a non-negative integer");
  return config;
}

export function evaluateResolutionPolicy(input: ResolutionPolicyInput): ResolutionPolicyDecision {
  const config = validateInput(input);
  const highRiskFlags = [...new Set(input.highRiskFlags ?? [])].sort();
  const result = input.outcome.status === "completed" ? input.outcome.result : null;
  const base = {
    exceptionId: input.exceptionId,
    recommendedAction: result?.recommendedAction ?? null,
    policySnapshot: {
      ...config,
      amountAtRiskPaise: input.amountAtRiskPaise,
      confidence: result?.confidence ?? null,
      deterministicEvidenceSupportsClaim: input.deterministicEvidenceSupportsClaim,
      actionExecutionReady: input.actionExecutionReady,
      highRiskFlags,
    },
  };

  if (!result) return { ...base, decision: "unresolved", reasons: ["AI_ERROR"] };
  if (result.exceptionId !== input.exceptionId) return { ...base, decision: "unresolved", reasons: ["EXCEPTION_ID_MISMATCH"] };
  if (result.recommendedAction === "no_action" && result.rootCause !== "insufficient_evidence") {
    return { ...base, decision: "unresolved", reasons: ["NO_ACTION_RECOMMENDED"] };
  }

  const reviewReasons: PolicyReasonCode[] = [];
  if (result.rootCause === "insufficient_evidence") reviewReasons.push("INSUFFICIENT_EVIDENCE");
  if (result.rootCause === "ambiguous_match") reviewReasons.push("AMBIGUOUS_MATCH");
  if (result.requiresHumanApproval) reviewReasons.push("MODEL_REQUIRES_APPROVAL");
  if (result.confidence < config.minimumAutoResolveConfidence) reviewReasons.push("LOW_CONFIDENCE");
  if (input.amountAtRiskPaise > config.maximumAutoResolveAmountPaise) reviewReasons.push("AMOUNT_OVER_LIMIT");
  if (highRiskFlags.length > 0) reviewReasons.push("HIGH_RISK_FLAG");
  if (!input.deterministicEvidenceSupportsClaim) reviewReasons.push("DETERMINISTIC_SUPPORT_MISSING");
  if (!input.actionExecutionReady) reviewReasons.push("ACTION_EXECUTION_NOT_READY");
  if (!reversibleActions.has(result.recommendedAction)) reviewReasons.push("ACTION_NOT_REVERSIBLE");
  if (result.recommendedAction === "propose_adjustment") reviewReasons.push("FINANCIAL_ADJUSTMENT_REQUIRES_REVIEW");
  if (result.recommendedAction === "create_review_case") reviewReasons.push("REVIEW_REQUESTED");

  if (reviewReasons.length > 0) return { ...base, decision: "human_review", reasons: reviewReasons };
  return { ...base, decision: "auto_resolve", reasons: ["ALL_AUTO_RESOLVE_GATES_PASSED"] };
}
