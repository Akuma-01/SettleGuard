import { describe, expect, it } from "vitest";
import { buildActionPlan } from "../src/policy/action-plan.js";
import type { InvestigationResult } from "../src/agent/schema.js";
import type { ExceptionRecord } from "../src/db/schema.js";

const exception: ExceptionRecord = {
  id: 10,
  runId: 4,
  type: "FEE_MISMATCH",
  severity: "medium",
  status: "OPEN",
  amountAtRiskPaise: 500,
  primaryRecordType: "settlement",
  primaryRecordId: 2,
  summary: "fee mismatch",
  deterministicEvidenceJson: { settlementId: 2, correctFeePaise: 100, reportedFeePaise: 120 },
  createdAt: new Date("2026-09-01T00:00:00Z"),
  resolvedAt: null,
};

const investigation: InvestigationResult = {
  exceptionId: 10,
  rootCause: "fee_mismatch",
  confidence: 0.99,
  evidence: [{ recordId: "settlement:2", reason: "Verified fee mismatch." }],
  recommendedAction: "rerun_reconciliation",
  requiresHumanApproval: false,
  explanation: "Rerun deterministic reconciliation.",
};

describe("buildActionPlan", () => {
  it("derives rerun scope from trusted exception state", () => {
    expect(buildActionPlan(exception, investigation)).toEqual({
      ready: true,
      reason: "READY",
      plan: { action: "rerun_reconciliation", exceptionId: 10, reconciliationRunId: 4 },
    });
  });

  it("derives an ambiguous bank link only from deterministic evidence", () => {
    const ambiguousException: ExceptionRecord = {
      ...exception,
      type: "AMBIGUOUS_MATCH",
      deterministicEvidenceJson: { bankTransactionId: 8, settlementId: 2, bankReference: "BAD", settlementBankReference: "GOOD" },
    };
    const result = buildActionPlan(ambiguousException, {
      ...investigation,
      rootCause: "ambiguous_match",
      recommendedAction: "link_record",
    });
    expect(result).toMatchObject({
      ready: true,
      plan: { action: "link_record", sourceType: "bank_transaction", sourceId: 8, targetType: "settlement", targetId: 2 },
    });
  });

  it("fails closed when deterministic support is absent", () => {
    expect(buildActionPlan({ ...exception, deterministicEvidenceJson: {} }, investigation)).toEqual({
      ready: false,
      reason: "DETERMINISTIC_SUPPORT_REQUIRED",
      plan: null,
    });
  });

  it("rejects cross-exception plans", () => {
    expect(buildActionPlan(exception, { ...investigation, exceptionId: 99 }).reason).toBe("EXCEPTION_ID_MISMATCH");
  });

  it("does not create a link plan for non-ambiguous exceptions", () => {
    expect(buildActionPlan(exception, { ...investigation, recommendedAction: "link_record" }).reason).toBe("LINK_TARGET_NOT_DETERMINISTIC");
  });

  it("does not treat reclassification to the existing type as an executable action", () => {
    expect(buildActionPlan(exception, { ...investigation, recommendedAction: "reclassify" }).reason).toBe("RECLASSIFICATION_IS_NOOP");
  });

  it("keeps review, adjustment, and no-action recommendations out of the execution path", () => {
    expect(buildActionPlan(exception, { ...investigation, recommendedAction: "create_review_case" }).reason).toBe("ACTION_REQUIRES_HUMAN_WORKFLOW");
    expect(buildActionPlan(exception, { ...investigation, recommendedAction: "propose_adjustment" }).reason).toBe("ACTION_REQUIRES_HUMAN_WORKFLOW");
    expect(buildActionPlan(exception, { ...investigation, recommendedAction: "no_action" }).reason).toBe("NO_ACTION_REQUESTED");
  });
});
