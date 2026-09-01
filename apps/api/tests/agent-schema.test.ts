import { describe, expect, it } from "vitest";
import { investigationResultSchema } from "../src/agent/schema.js";

const validResult = {
  exceptionId: 42,
  rootCause: "unknown_adjustment" as const,
  confidence: 0.6,
  evidence: [
    { recordId: "adjustment:100", reason: "The verified adjustment has no source reference." },
    { recordId: "settlement:20", reason: "Confirmed settlement context does not explain the deduction." },
  ],
  recommendedAction: "create_review_case" as const,
  requiresHumanApproval: true,
  explanation: "The unexplained adjustment requires source-system review.",
};

describe("investigationResultSchema", () => {
  it("accepts a well-formed result", () => {
    expect(investigationResultSchema.safeParse(validResult).success).toBe(true);
  });

  it("rejects missing and additional fields", () => {
    const { rootCause, ...missing } = validResult;
    expect(investigationResultSchema.safeParse(missing).success).toBe(false);
    expect(investigationResultSchema.safeParse({ ...validResult, policyDecision: "auto_resolve" }).success).toBe(false);
  });

  it("rejects confidence outside 0-1", () => {
    expect(investigationResultSchema.safeParse({ ...validResult, confidence: 1.5 }).success).toBe(false);
    expect(investigationResultSchema.safeParse({ ...validResult, confidence: -0.1 }).success).toBe(false);
  });

  it("requires structured evidence with a record ID and reason", () => {
    expect(investigationResultSchema.safeParse({ ...validResult, evidence: [] }).success).toBe(false);
    expect(investigationResultSchema.safeParse({ ...validResult, evidence: ["unverifiable prose"] }).success).toBe(false);
    expect(investigationResultSchema.safeParse({ ...validResult, evidence: [{ recordId: "", reason: "x" }] }).success).toBe(false);
  });

  it("rejects policy outcomes such as auto_resolve as recommended actions", () => {
    expect(investigationResultSchema.safeParse({ ...validResult, recommendedAction: "auto_resolve" }).success).toBe(false);
  });

  it("accepts every concrete recommendation value", () => {
    for (const action of ["link_record", "reclassify", "rerun_reconciliation", "create_review_case", "propose_adjustment", "no_action"] as const) {
      expect(investigationResultSchema.safeParse({ ...validResult, recommendedAction: action }).success).toBe(true);
    }
  });

  it("accepts every supported root-cause label", () => {
    for (const rootCause of ["duplicate_refund", "missing_settlement", "missing_refund_link", "fee_mismatch", "unknown_adjustment", "missing_bank_credit", "bank_credit_mismatch", "timing_difference", "ambiguous_match", "insufficient_evidence", "other"] as const) {
      expect(investigationResultSchema.safeParse({ ...validResult, rootCause }).success).toBe(true);
    }
  });
});
