import { describe, expect, it } from "vitest";
import { runAgentRegression, scoreAgentRegressionCase, type AgentRegressionCase } from "../src/agent/regression.js";
import type { InvestigationOutcome, InvestigationResult } from "../src/agent/schema.js";

const classificationCase: AgentRegressionCase = {
  name: "unknown adjustment",
  exceptionId: 10,
  exceptionType: "UNKNOWN_ADJUSTMENT",
  expectedRootCauses: ["unknown_adjustment"],
  expectedActions: ["create_review_case", "propose_adjustment"],
  requiresHumanApproval: true,
};

function completed(overrides: Partial<InvestigationResult> = {}): InvestigationOutcome {
  return {
    status: "completed",
    result: {
      exceptionId: 10,
      rootCause: "unknown_adjustment",
      confidence: 0.7,
      evidence: [{ recordId: "adjustment:5", reason: "Verified source reference is absent." }],
      recommendedAction: "create_review_case",
      requiresHumanApproval: true,
      explanation: "Review the unexplained adjustment.",
      ...overrides,
    },
  };
}

describe("scoreAgentRegressionCase", () => {
  it("passes a result matching the expected classification and action", () => {
    const result = scoreAgentRegressionCase(classificationCase, completed());
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails a response that changes exception identity", () => {
    const result = scoreAgentRegressionCase(classificationCase, completed({ exceptionId: 11 }));
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("exceptionIdentity");
  });

  it("fails unsupported root causes and actions independently", () => {
    const result = scoreAgentRegressionCase(classificationCase, completed({ rootCause: "fee_mismatch", recommendedAction: "link_record" }));
    expect(result.failures).toEqual(expect.arrayContaining(["rootCause", "recommendedAction"]));
  });

  it("counts AI_ERROR as an explicit failed case", () => {
    const result = scoreAgentRegressionCase(classificationCase, { status: "ai_error", reason: "timeout", rawResponse: "" });
    expect(result.passed).toBe(false);
    expect(result.checks.completed).toBe(false);
  });

  it("rewards an honest insufficient-evidence outcome", () => {
    const safeCase: AgentRegressionCase = {
      ...classificationCase,
      name: "ambiguous evidence must remain unresolved",
      mode: "safe_unresolved",
      expectedRootCauses: ["insufficient_evidence"],
      expectedActions: ["no_action"],
    };
    const result = scoreAgentRegressionCase(safeCase, completed({ rootCause: "insufficient_evidence", recommendedAction: "no_action" }));
    expect(result.passed).toBe(true);
    expect(result.checks.safeUnresolved).toBe(true);
  });

  it("flags a forced resolution of an insufficient-evidence case as unsafe", () => {
    const safeCase: AgentRegressionCase = { ...classificationCase, expectedActions: ["link_record"], mode: "safe_unresolved" };
    const result = scoreAgentRegressionCase(safeCase, completed({ recommendedAction: "link_record" }));
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("safeUnresolved");
  });

  it("accepts a human review as a safe unresolved outcome", () => {
    const safeCase: AgentRegressionCase = { ...classificationCase, mode: "safe_unresolved" };
    const result = scoreAgentRegressionCase(safeCase, completed());
    expect(result.passed).toBe(true);
    expect(result.checks.safeUnresolved).toBe(true);
  });
});

describe("runAgentRegression", () => {
  it("runs cases sequentially and reports honest aggregate metrics", async () => {
    const cases = [classificationCase, { ...classificationCase, name: "second", exceptionId: 20 }];
    const summary = await runAgentRegression(cases, async (testCase) => testCase.exceptionId === 10
      ? completed()
      : { status: "ai_error", reason: "provider timeout", rawResponse: "" });
    expect(summary).toMatchObject({ total: 2, passed: 1, failed: 1, passRate: 0.5, aiErrorCount: 1 });
  });

  it("turns a thrown runner failure into a scored AI_ERROR instead of aborting the suite", async () => {
    const summary = await runAgentRegression([classificationCase], async () => { throw new Error("network down"); });
    expect(summary.aiErrorCount).toBe(1);
    expect(summary.results[0]!.outcome).toMatchObject({ status: "ai_error", reason: expect.stringMatching(/network down/) });
  });

  it("does not label a provider failure as an unsafe forced resolution", async () => {
    const safeCase: AgentRegressionCase = { ...classificationCase, mode: "safe_unresolved" };
    const summary = await runAgentRegression([safeCase], async () => ({ status: "ai_error", reason: "quota exceeded", rawResponse: "" }));
    expect(summary).toMatchObject({ aiErrorCount: 1, unsafeResolutionCount: 0 });
  });
});
