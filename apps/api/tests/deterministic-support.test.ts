import { describe, expect, it } from "vitest";
import { verifyDeterministicSupport } from "../src/policy/deterministic-support.js";
import type { InvestigationResult } from "../src/agent/schema.js";
import type { ExceptionRecord } from "../src/db/schema.js";

function exception(type: string, primaryRecordType: string, primaryRecordId: number, evidence: Record<string, unknown>): ExceptionRecord {
  return {
    id: 10,
    runId: 1,
    type,
    severity: "medium",
    status: "OPEN",
    amountAtRiskPaise: 500,
    primaryRecordType,
    primaryRecordId,
    summary: type,
    deterministicEvidenceJson: evidence,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    resolvedAt: null,
  };
}

function investigation(rootCause: InvestigationResult["rootCause"]): InvestigationResult {
  return {
    exceptionId: 10,
    rootCause,
    confidence: 0.99,
    evidence: [{ recordId: "exception:10", reason: "Verified exception evidence." }],
    recommendedAction: "rerun_reconciliation",
    requiresHumanApproval: false,
    explanation: "Verified by deterministic reconciliation evidence.",
  };
}

describe("verifyDeterministicSupport", () => {
  it.each([
    {
      type: "MISSING_SETTLEMENT", recordType: "payment", recordId: 1, rootCause: "missing_settlement" as const,
      evidence: { paymentId: 1, expectedSettlementId: 2, candidateGrossPaise: 5_000, reportedGrossPaise: 4_000 },
      reason: "SUPPORTED_MISSING_SETTLEMENT",
    },
    {
      type: "FEE_MISMATCH", recordType: "settlement", recordId: 2, rootCause: "fee_mismatch" as const,
      evidence: { settlementId: 2, correctFeePaise: 100, reportedFeePaise: 120, correctTaxPaise: 18, reportedTaxPaise: 22 },
      reason: "SUPPORTED_FEE_MISMATCH",
    },
    {
      type: "UNKNOWN_ADJUSTMENT", recordType: "adjustment", recordId: 3, rootCause: "unknown_adjustment" as const,
      evidence: { settlementId: 2, adjustmentId: 3, amountPaise: -500 },
      reason: "SUPPORTED_UNKNOWN_ADJUSTMENT",
    },
    {
      type: "DUPLICATE_REFUND", recordType: "refund", recordId: 4, rootCause: "duplicate_refund" as const,
      evidence: { originalRefundId: 3, duplicateRefundId: 4, paymentId: 1, amountPaise: 500 },
      reason: "SUPPORTED_DUPLICATE_REFUND",
    },
    {
      type: "BANK_CREDIT_MISMATCH", recordType: "settlement", recordId: 2, rootCause: "bank_credit_mismatch" as const,
      evidence: { bankTransactionId: 5, settlementId: 2, expectedPaise: 10_000, actualPaise: 9_000 },
      reason: "SUPPORTED_BANK_CREDIT_MISMATCH",
    },
    {
      type: "AMBIGUOUS_MATCH", recordType: "settlement", recordId: 2, rootCause: "ambiguous_match" as const,
      evidence: { bankTransactionId: 5, settlementId: 2, bankReference: "WRONG", settlementBankReference: "RIGHT" },
      reason: "SUPPORTED_AMBIGUOUS_MATCH",
    },
  ])("supports $type only from its exact deterministic evidence shape", ({ type, recordType, recordId, rootCause, evidence, reason }) => {
    expect(verifyDeterministicSupport(exception(type, recordType, recordId, evidence), investigation(rootCause))).toMatchObject({ supported: true, reason });
  });

  it("rejects a root cause that does not match the deterministic exception", () => {
    const result = verifyDeterministicSupport(
      exception("FEE_MISMATCH", "settlement", 2, { settlementId: 2, correctFeePaise: 100, reportedFeePaise: 120 }),
      investigation("other"),
    );
    expect(result).toEqual({ supported: false, reason: "ROOT_CAUSE_MISMATCH", verifiedRecordIds: [] });
  });

  it("rejects evidence attached to a different primary record", () => {
    const result = verifyDeterministicSupport(
      exception("DUPLICATE_REFUND", "refund", 4, { originalRefundId: 3, duplicateRefundId: 99, paymentId: 1, amountPaise: 500 }),
      investigation("duplicate_refund"),
    );
    expect(result.reason).toBe("PRIMARY_RECORD_MISMATCH");
  });

  it("rejects malformed evidence that does not actually show a discrepancy", () => {
    const result = verifyDeterministicSupport(
      exception("BANK_CREDIT_MISMATCH", "settlement", 2, { bankTransactionId: 5, settlementId: 2, expectedPaise: 10_000, actualPaise: 10_000 }),
      investigation("bank_credit_mismatch"),
    );
    expect(result.reason).toBe("EVIDENCE_MALFORMED");
  });

  it("rejects cross-exception results before inspecting evidence", () => {
    expect(verifyDeterministicSupport(
      exception("FEE_MISMATCH", "settlement", 2, { settlementId: 2 }),
      { ...investigation("fee_mismatch"), exceptionId: 11 },
    ).reason).toBe("EXCEPTION_ID_MISMATCH");
  });

  it("rejects unsupported exception classes by default", () => {
    expect(verifyDeterministicSupport(exception("NEW_TYPE", "payment", 1, {}), investigation("other")).reason).toBe("UNSUPPORTED_EXCEPTION_TYPE");
  });
});
