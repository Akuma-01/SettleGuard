import { describe, expect, it } from "vitest";
import { decideResolution } from "../src/policy/decide-resolution.js";
import type { InvestigationOutcome, InvestigationResult } from "../src/agent/schema.js";
import type { ExceptionRecord } from "../src/db/schema.js";

const feeException: ExceptionRecord = {
  id: 10,
  runId: 4,
  type: "FEE_MISMATCH",
  severity: "medium",
  status: "OPEN",
  amountAtRiskPaise: 500,
  primaryRecordType: "settlement",
  primaryRecordId: 2,
  summary: "fee mismatch",
  deterministicEvidenceJson: { settlementId: 2, correctFeePaise: 100, reportedFeePaise: 120, correctTaxPaise: 18, reportedTaxPaise: 22 },
  createdAt: new Date("2026-09-01T00:00:00Z"),
  resolvedAt: null,
};

const feeResult: InvestigationResult = {
  exceptionId: 10,
  rootCause: "fee_mismatch",
  confidence: 0.99,
  evidence: [{ recordId: "settlement:2", reason: "Verified fee mismatch." }],
  recommendedAction: "rerun_reconciliation",
  requiresHumanApproval: false,
  explanation: "Rerun deterministic reconciliation.",
};

function completed(result: InvestigationResult = feeResult): InvestigationOutcome {
  return { status: "completed", result };
}

describe("decideResolution", () => {
  it("auto-resolves only when support, plan, and every policy gate agree", () => {
    const decision = decideResolution({ exception: feeException, outcome: completed() });
    expect(decision.support).toMatchObject({ supported: true, reason: "SUPPORTED_FEE_MISMATCH" });
    expect(decision.actionPlan).toMatchObject({ ready: true, plan: { action: "rerun_reconciliation", reconciliationRunId: 4 } });
    expect(decision.policy).toMatchObject({ decision: "auto_resolve", reasons: ["ALL_AUTO_RESOLVE_GATES_PASSED"] });
  });

  it("routes a supported but ambiguous link to review", () => {
    const exception: ExceptionRecord = {
      ...feeException,
      type: "AMBIGUOUS_MATCH",
      primaryRecordType: "settlement",
      deterministicEvidenceJson: { bankTransactionId: 8, settlementId: 2, bankReference: "BAD", settlementBankReference: "GOOD" },
    };
    const result: InvestigationResult = { ...feeResult, rootCause: "ambiguous_match", recommendedAction: "link_record" };
    const decision = decideResolution({ exception, outcome: completed(result) });
    expect(decision.actionPlan?.ready).toBe(true);
    expect(decision.policy).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["AMBIGUOUS_MATCH"]) });
  });

  it("routes insufficient evidence to review without an executable plan", () => {
    const exception: ExceptionRecord = {
      ...feeException,
      type: "UNKNOWN_ADJUSTMENT",
      primaryRecordType: "adjustment",
      primaryRecordId: 3,
      deterministicEvidenceJson: { settlementId: 2, adjustmentId: 3, amountPaise: -500 },
    };
    const result: InvestigationResult = {
      ...feeResult,
      rootCause: "insufficient_evidence",
      recommendedAction: "no_action",
      confidence: 0.3,
      requiresHumanApproval: true,
    };
    const decision = decideResolution({ exception, outcome: completed(result) });
    expect(decision.support?.supported).toBe(false);
    expect(decision.actionPlan).toMatchObject({ ready: false, reason: "DETERMINISTIC_SUPPORT_REQUIRED" });
    expect(decision.policy).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["INSUFFICIENT_EVIDENCE"]) });
  });

  it("keeps AI errors unresolved", () => {
    const decision = decideResolution({ exception: feeException, outcome: { status: "ai_error", reason: "timeout", rawResponse: "" } });
    expect(decision.support).toBeNull();
    expect(decision.actionPlan).toBeNull();
    expect(decision.policy).toMatchObject({ decision: "unresolved", reasons: ["AI_ERROR"] });
  });

  it("derives risk flags from high severity and non-open state", () => {
    const decision = decideResolution({
      exception: { ...feeException, severity: "high", status: "RESOLVED", resolvedAt: new Date("2026-09-01T01:00:00Z") },
      outcome: completed(),
      additionalHighRiskFlags: ["MANUAL_HOLD", "MANUAL_HOLD"],
    });
    expect(decision.policy.decision).toBe("human_review");
    expect(decision.policy.policySnapshot.highRiskFlags).toEqual(["ALREADY_RESOLVED", "EXCEPTION_NOT_OPEN", "HIGH_SEVERITY", "MANUAL_HOLD"]);
  });

  it("cannot auto-resolve when the action cannot be parameterized", () => {
    const decision = decideResolution({ exception: feeException, outcome: completed({ ...feeResult, recommendedAction: "reclassify" }) });
    expect(decision.actionPlan).toMatchObject({ ready: false, reason: "RECLASSIFICATION_IS_NOOP" });
    expect(decision.policy).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["ACTION_EXECUTION_NOT_READY"]) });
  });
});
