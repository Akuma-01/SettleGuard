/** Build executable action parameters exclusively from deterministic records and evidence. */
import type { InvestigationResult } from "../agent/schema.js";
import type { ExceptionRecord } from "../db/schema.js";
import { verifyDeterministicSupport } from "./deterministic-support.js";

export type ExecutableActionPlan =
  | {
      action: "link_record";
      exceptionId: number;
      sourceType: "bank_transaction";
      sourceId: number;
      targetType: "settlement";
      targetId: number;
    }
  | {
      action: "rerun_reconciliation";
      exceptionId: number;
      reconciliationRunId: number;
    };

export type ActionPlanReason =
  | "READY"
  | "DETERMINISTIC_SUPPORT_REQUIRED"
  | "EXCEPTION_ID_MISMATCH"
  | "ACTION_REQUIRES_HUMAN_WORKFLOW"
  | "NO_ACTION_REQUESTED"
  | "RECLASSIFICATION_IS_NOOP"
  | "RECLASSIFICATION_NOT_DETERMINISTIC"
  | "LINK_TARGET_NOT_DETERMINISTIC"
  | "ACTION_NOT_IMPLEMENTED";

export type ActionPlanResult =
  | { ready: true; reason: "READY"; plan: ExecutableActionPlan }
  | { ready: false; reason: Exclude<ActionPlanReason, "READY">; plan: null };

const rootCauseToExceptionType: Partial<Record<InvestigationResult["rootCause"], string>> = {
  missing_settlement: "MISSING_SETTLEMENT",
  fee_mismatch: "FEE_MISMATCH",
  unknown_adjustment: "UNKNOWN_ADJUSTMENT",
  duplicate_refund: "DUPLICATE_REFUND",
  bank_credit_mismatch: "BANK_CREDIT_MISMATCH",
  ambiguous_match: "AMBIGUOUS_MATCH",
};

function evidenceObject(exception: ExceptionRecord): Record<string, unknown> {
  const evidence = exception.deterministicEvidenceJson;
  return evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence as Record<string, unknown> : {};
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function buildActionPlan(
  exception: ExceptionRecord,
  investigation: InvestigationResult,
): ActionPlanResult {
  if (investigation.exceptionId !== exception.id) return { ready: false, reason: "EXCEPTION_ID_MISMATCH", plan: null };
  const support = verifyDeterministicSupport(exception, investigation);
  if (!support.supported) return { ready: false, reason: "DETERMINISTIC_SUPPORT_REQUIRED", plan: null };

  switch (investigation.recommendedAction) {
    case "rerun_reconciliation":
      return {
        ready: true,
        reason: "READY",
        plan: { action: "rerun_reconciliation", exceptionId: exception.id, reconciliationRunId: exception.runId },
      };
    case "link_record": {
      if (exception.type !== "AMBIGUOUS_MATCH" || investigation.rootCause !== "ambiguous_match") {
        return { ready: false, reason: "LINK_TARGET_NOT_DETERMINISTIC", plan: null };
      }
      const evidence = evidenceObject(exception);
      if (!positiveInteger(evidence.bankTransactionId) || !positiveInteger(evidence.settlementId)) {
        return { ready: false, reason: "LINK_TARGET_NOT_DETERMINISTIC", plan: null };
      }
      return {
        ready: true,
        reason: "READY",
        plan: {
          action: "link_record",
          exceptionId: exception.id,
          sourceType: "bank_transaction",
          sourceId: evidence.bankTransactionId,
          targetType: "settlement",
          targetId: evidence.settlementId,
        },
      };
    }
    case "reclassify": {
      const targetType = rootCauseToExceptionType[investigation.rootCause];
      if (!targetType) return { ready: false, reason: "RECLASSIFICATION_NOT_DETERMINISTIC", plan: null };
      if (targetType === exception.type) return { ready: false, reason: "RECLASSIFICATION_IS_NOOP", plan: null };
      // A differing type cannot be supported by today's verifier, which is
      // intentionally keyed to the detected class. Human review must bridge it.
      return { ready: false, reason: "RECLASSIFICATION_NOT_DETERMINISTIC", plan: null };
    }
    case "create_review_case":
    case "propose_adjustment":
      return { ready: false, reason: "ACTION_REQUIRES_HUMAN_WORKFLOW", plan: null };
    case "no_action":
      return { ready: false, reason: "NO_ACTION_REQUESTED", plan: null };
    default:
      return { ready: false, reason: "ACTION_NOT_IMPLEMENTED", plan: null };
  }
}
