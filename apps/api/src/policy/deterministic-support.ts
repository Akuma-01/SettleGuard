/** Verify that reconciliation evidence deterministically supports the agent's root-cause label. */
import type { InvestigationResult } from "../agent/schema.js";
import type { ExceptionRecord } from "../db/schema.js";

export type SupportReason =
  | "SUPPORTED_MISSING_SETTLEMENT"
  | "SUPPORTED_FEE_MISMATCH"
  | "SUPPORTED_UNKNOWN_ADJUSTMENT"
  | "SUPPORTED_DUPLICATE_REFUND"
  | "SUPPORTED_BANK_CREDIT_MISMATCH"
  | "SUPPORTED_AMBIGUOUS_MATCH"
  | "EXCEPTION_ID_MISMATCH"
  | "ROOT_CAUSE_MISMATCH"
  | "PRIMARY_RECORD_MISMATCH"
  | "EVIDENCE_MALFORMED"
  | "UNSUPPORTED_EXCEPTION_TYPE";

export interface DeterministicSupportResult {
  supported: boolean;
  reason: SupportReason;
  verifiedRecordIds: string[];
}

function evidenceObject(exception: ExceptionRecord): Record<string, unknown> | null {
  const value = exception.deterministicEvidenceJson;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fail(reason: SupportReason): DeterministicSupportResult {
  return { supported: false, reason, verifiedRecordIds: [] };
}

function supported(reason: SupportReason, ids: string[]): DeterministicSupportResult {
  return { supported: true, reason, verifiedRecordIds: [...new Set(ids)] };
}

export function verifyDeterministicSupport(
  exception: ExceptionRecord,
  investigation: InvestigationResult,
): DeterministicSupportResult {
  if (investigation.exceptionId !== exception.id) return fail("EXCEPTION_ID_MISMATCH");
  const evidence = evidenceObject(exception);
  if (!evidence) return fail("EVIDENCE_MALFORMED");

  switch (exception.type) {
    case "MISSING_SETTLEMENT": {
      if (investigation.rootCause !== "missing_settlement") return fail("ROOT_CAUSE_MISMATCH");
      if (exception.primaryRecordType !== "payment" || !positiveInteger(exception.primaryRecordId) || evidence.paymentId !== exception.primaryRecordId) return fail("PRIMARY_RECORD_MISMATCH");
      if (!positiveInteger(evidence.expectedSettlementId) || !finiteNumber(evidence.candidateGrossPaise) || !finiteNumber(evidence.reportedGrossPaise) || evidence.candidateGrossPaise === evidence.reportedGrossPaise) return fail("EVIDENCE_MALFORMED");
      return supported("SUPPORTED_MISSING_SETTLEMENT", [`payment:${exception.primaryRecordId}`, `settlement:${evidence.expectedSettlementId}`]);
    }
    case "FEE_MISMATCH": {
      if (investigation.rootCause !== "fee_mismatch") return fail("ROOT_CAUSE_MISMATCH");
      if (exception.primaryRecordType !== "settlement" || !positiveInteger(exception.primaryRecordId) || evidence.settlementId !== exception.primaryRecordId) return fail("PRIMARY_RECORD_MISMATCH");
      if (!finiteNumber(evidence.correctFeePaise) || !finiteNumber(evidence.reportedFeePaise) || evidence.correctFeePaise === evidence.reportedFeePaise) return fail("EVIDENCE_MALFORMED");
      return supported("SUPPORTED_FEE_MISMATCH", [`settlement:${exception.primaryRecordId}`]);
    }
    case "UNKNOWN_ADJUSTMENT": {
      if (investigation.rootCause !== "unknown_adjustment") return fail("ROOT_CAUSE_MISMATCH");
      if (exception.primaryRecordType !== "adjustment" || !positiveInteger(exception.primaryRecordId) || evidence.adjustmentId !== exception.primaryRecordId) return fail("PRIMARY_RECORD_MISMATCH");
      if (!positiveInteger(evidence.settlementId) || !finiteNumber(evidence.amountPaise)) return fail("EVIDENCE_MALFORMED");
      return supported("SUPPORTED_UNKNOWN_ADJUSTMENT", [`adjustment:${exception.primaryRecordId}`, `settlement:${evidence.settlementId}`]);
    }
    case "DUPLICATE_REFUND": {
      if (investigation.rootCause !== "duplicate_refund") return fail("ROOT_CAUSE_MISMATCH");
      if (exception.primaryRecordType !== "refund" || !positiveInteger(exception.primaryRecordId) || evidence.duplicateRefundId !== exception.primaryRecordId) return fail("PRIMARY_RECORD_MISMATCH");
      if (!positiveInteger(evidence.originalRefundId) || evidence.originalRefundId === evidence.duplicateRefundId || !positiveInteger(evidence.paymentId) || !finiteNumber(evidence.amountPaise)) return fail("EVIDENCE_MALFORMED");
      return supported("SUPPORTED_DUPLICATE_REFUND", [`refund:${evidence.originalRefundId}`, `refund:${exception.primaryRecordId}`, `payment:${evidence.paymentId}`]);
    }
    case "BANK_CREDIT_MISMATCH": {
      if (investigation.rootCause !== "bank_credit_mismatch") return fail("ROOT_CAUSE_MISMATCH");
      if (exception.primaryRecordType !== "settlement" || !positiveInteger(exception.primaryRecordId) || evidence.settlementId !== exception.primaryRecordId) return fail("PRIMARY_RECORD_MISMATCH");
      if (!positiveInteger(evidence.bankTransactionId) || !finiteNumber(evidence.expectedPaise) || !finiteNumber(evidence.actualPaise) || evidence.expectedPaise === evidence.actualPaise) return fail("EVIDENCE_MALFORMED");
      return supported("SUPPORTED_BANK_CREDIT_MISMATCH", [`settlement:${exception.primaryRecordId}`, `bank_transaction:${evidence.bankTransactionId}`]);
    }
    case "AMBIGUOUS_MATCH": {
      if (investigation.rootCause !== "ambiguous_match") return fail("ROOT_CAUSE_MISMATCH");
      if (exception.primaryRecordType !== "settlement" || !positiveInteger(exception.primaryRecordId) || evidence.settlementId !== exception.primaryRecordId) return fail("PRIMARY_RECORD_MISMATCH");
      if (!positiveInteger(evidence.bankTransactionId) || typeof evidence.bankReference !== "string" || typeof evidence.settlementBankReference !== "string" || evidence.bankReference === evidence.settlementBankReference) return fail("EVIDENCE_MALFORMED");
      return supported("SUPPORTED_AMBIGUOUS_MATCH", [`settlement:${exception.primaryRecordId}`, `bank_transaction:${evidence.bankTransactionId}`]);
    }
    default:
      return fail("UNSUPPORTED_EXCEPTION_TYPE");
  }
}
