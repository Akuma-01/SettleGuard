import { describe, expect, it } from "vitest";
import { evaluateResolutionPolicy, type ResolutionPolicyInput } from "../src/policy/resolution-policy.js";
import type { InvestigationOutcome, InvestigationResult } from "../src/agent/schema.js";

const baseResult: InvestigationResult = {
  exceptionId: 7,
  rootCause: "fee_mismatch",
  confidence: 0.98,
  evidence: [{ recordId: "settlement:10", reason: "Deterministic fee calculation differs from the report." }],
  recommendedAction: "rerun_reconciliation",
  requiresHumanApproval: false,
  explanation: "Re-run after applying the verified internal classification.",
};

function input(overrides: Partial<ResolutionPolicyInput> = {}, resultOverrides: Partial<InvestigationResult> = {}): ResolutionPolicyInput {
  const outcome: InvestigationOutcome = { status: "completed", result: { ...baseResult, ...resultOverrides } };
  return { exceptionId: 7, amountAtRiskPaise: 50_000, outcome, deterministicEvidenceSupportsClaim: true, actionExecutionReady: true, ...overrides };
}

describe("evaluateResolutionPolicy", () => {
  it("auto-resolves only when every deterministic gate passes", () => {
    expect(evaluateResolutionPolicy(input())).toMatchObject({
      decision: "auto_resolve",
      recommendedAction: "rerun_reconciliation",
      reasons: ["ALL_AUTO_RESOLVE_GATES_PASSED"],
    });
  });

  it("requires review below the confidence threshold", () => {
    expect(evaluateResolutionPolicy(input({}, { confidence: 0.949 }))).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["LOW_CONFIDENCE"]) });
  });

  it("allows the exact confidence and amount boundaries", () => {
    const decision = evaluateResolutionPolicy(input({ amountAtRiskPaise: 100_000 }, { confidence: 0.95 }));
    expect(decision.decision).toBe("auto_resolve");
  });

  it("requires review above ₹1,000 at risk", () => {
    expect(evaluateResolutionPolicy(input({ amountAtRiskPaise: 100_001 }))).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["AMOUNT_OVER_LIMIT"]) });
  });

  it("requires review for missing deterministic support or any high-risk flag", () => {
    const decision = evaluateResolutionPolicy(input({ deterministicEvidenceSupportsClaim: false, highRiskFlags: ["HIGH_VALUE", "HIGH_VALUE"] }));
    expect(decision.decision).toBe("human_review");
    expect(decision.reasons).toEqual(expect.arrayContaining(["DETERMINISTIC_SUPPORT_MISSING", "HIGH_RISK_FLAG"]));
    expect(decision.policySnapshot.highRiskFlags).toEqual(["HIGH_VALUE"]);
  });

  it("does not authorize a reversible action name without validated execution parameters", () => {
    const decision = evaluateResolutionPolicy(input({ actionExecutionReady: false }));
    expect(decision).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["ACTION_EXECUTION_NOT_READY"]) });
  });

  it("never auto-resolves ambiguous or insufficient evidence", () => {
    expect(evaluateResolutionPolicy(input({}, { rootCause: "ambiguous_match" }))).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["AMBIGUOUS_MATCH"]) });
    expect(evaluateResolutionPolicy(input({}, { rootCause: "insufficient_evidence", recommendedAction: "no_action" }))).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["INSUFFICIENT_EVIDENCE"]) });
  });

  it("honors the model's request for approval but not its ability to waive policy", () => {
    expect(evaluateResolutionPolicy(input({}, { requiresHumanApproval: true }))).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["MODEL_REQUIRES_APPROVAL"]) });
    expect(evaluateResolutionPolicy(input({ amountAtRiskPaise: 500_000 }, { requiresHumanApproval: false }))).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["AMOUNT_OVER_LIMIT"]) });
  });

  it("never auto-resolves review requests or financial adjustment proposals", () => {
    expect(evaluateResolutionPolicy(input({}, { recommendedAction: "create_review_case" }))).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["REVIEW_REQUESTED", "ACTION_NOT_REVERSIBLE"]) });
    expect(evaluateResolutionPolicy(input({}, { recommendedAction: "propose_adjustment" }))).toMatchObject({ decision: "human_review", reasons: expect.arrayContaining(["FINANCIAL_ADJUSTMENT_REQUIRES_REVIEW", "ACTION_NOT_REVERSIBLE"]) });
  });

  it("leaves explicit no-action and AI errors unresolved", () => {
    expect(evaluateResolutionPolicy(input({}, { rootCause: "other", recommendedAction: "no_action" }))).toMatchObject({ decision: "unresolved", reasons: ["NO_ACTION_RECOMMENDED"] });
    expect(evaluateResolutionPolicy(input({ outcome: { status: "ai_error", reason: "timeout", rawResponse: "" } }))).toMatchObject({ decision: "unresolved", reasons: ["AI_ERROR"] });
  });

  it("refuses to apply an investigation result to a different exception", () => {
    expect(evaluateResolutionPolicy(input({}, { exceptionId: 999 }))).toMatchObject({ decision: "unresolved", reasons: ["EXCEPTION_ID_MISMATCH"] });
  });

  it("captures the thresholds and facts used for reproducible decisions", () => {
    const decision = evaluateResolutionPolicy(input({ highRiskFlags: [] }));
    expect(decision.policySnapshot).toEqual({
      minimumAutoResolveConfidence: 0.95,
      maximumAutoResolveAmountPaise: 100_000,
      amountAtRiskPaise: 50_000,
      confidence: 0.98,
      deterministicEvidenceSupportsClaim: true,
      actionExecutionReady: true,
      highRiskFlags: [],
    });
  });

  it("rejects invalid monetary and policy inputs", () => {
    expect(() => evaluateResolutionPolicy(input({ amountAtRiskPaise: -1 }))).toThrow(/non-negative integer/);
    expect(() => evaluateResolutionPolicy(input({ config: { minimumAutoResolveConfidence: 2, maximumAutoResolveAmountPaise: 100 } }))).toThrow(/between 0 and 1/);
  });
});
