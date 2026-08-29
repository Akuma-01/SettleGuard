import { describe, expect, it } from "vitest";
import { investigationResultSchema } from "../src/agent/schema.js";

const validResult = {
  rootCause: "Adjustment likely corresponds to a chargeback fee not yet linked in the source system.",
  confidence: 0.6,
  evidence: ["Settlement gross matches all confirmed payments exactly", "No refund in this settlement is close to the adjustment amount"],
  recommendedAction: "human_review" as const,
  requiresHumanApproval: true,
  explanation: "The adjustment has no source_reference and doesn't match any payment or refund amount in the settlement.",
};

describe("investigationResultSchema", () => {
  it("accepts a well-formed result", () => {
    expect(investigationResultSchema.safeParse(validResult).success).toBe(true);
  });

  it("rejects a missing field", () => {
    const { rootCause, ...rest } = validResult;
    expect(investigationResultSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects confidence outside 0-1", () => {
    expect(investigationResultSchema.safeParse({ ...validResult, confidence: 1.5 }).success).toBe(false);
    expect(investigationResultSchema.safeParse({ ...validResult, confidence: -0.1 }).success).toBe(false);
  });

  it("rejects an empty evidence array — must cite at least one thing", () => {
    expect(investigationResultSchema.safeParse({ ...validResult, evidence: [] }).success).toBe(false);
  });

  it("rejects a recommendedAction outside the enum", () => {
    expect(investigationResultSchema.safeParse({ ...validResult, recommendedAction: "just_ignore_it" }).success).toBe(false);
  });

  it("accepts all three valid recommendedAction values", () => {
    for (const action of ["auto_resolve", "human_review", "unresolved"] as const) {
      expect(investigationResultSchema.safeParse({ ...validResult, recommendedAction: action }).success).toBe(true);
    }
  });
});
