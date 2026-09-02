import { describe, expect, it } from "vitest";
import { renderEvidencePage } from "../src/agent/evidence-html.js";
import type { ExceptionRecord } from "../src/db/schema.js";
import type { AgentStep } from "../src/agent/loop.js";

const exception: ExceptionRecord = {
  id: 463,
  runId: 1,
  type: "UNKNOWN_ADJUSTMENT",
  severity: "high",
  status: "OPEN",
  amountAtRiskPaise: 286187,
  primaryRecordType: "adjustment",
  primaryRecordId: 100,
  summary: "Adjustment ADJ_20260301_1 (-₹2,861.87) has no source_reference.",
  deterministicEvidenceJson: {},
  createdAt: new Date(),
  resolvedAt: null,
};

const steps: AgentStep[] = [
  { type: "tool_call", toolName: "get_adjustment", toolInput: { adjustmentId: 100 } },
  { type: "tool_result", toolName: "get_adjustment", toolOutput: { id: 100, sourceReference: null } },
  { type: "final_text", text: '{"rootCause": "..."}' },
];

describe("renderEvidencePage — completed outcome", () => {
  const html = renderEvidencePage({
    exception,
    steps,
    outcome: {
      status: "completed",
      result: {
        exceptionId: 463,
        rootCause: "unknown_adjustment",
        confidence: 0.55,
        evidence: [{ recordId: "adjustment:100", reason: "No matching payment or refund amount exists in the settlement." }],
        recommendedAction: "create_review_case",
        requiresHumanApproval: true,
        explanation: "Needs a human to confirm against the payment gateway's chargeback records.",
      },
    },
    policyDecision: "Review case #7 created.",
    resolutionDecision: {
      support: { supported: true, reason: "SUPPORTED_UNKNOWN_ADJUSTMENT", verifiedRecordIds: ["adjustment:100"] },
      actionPlan: { ready: false, reason: "ACTION_REQUIRES_HUMAN_WORKFLOW", plan: null },
      policy: {
        exceptionId: 463,
        decision: "human_review",
        recommendedAction: "create_review_case",
        reasons: ["MODEL_REQUIRES_APPROVAL", "LOW_CONFIDENCE", "HIGH_RISK_FLAG", "ACTION_EXECUTION_NOT_READY", "ACTION_NOT_REVERSIBLE", "REVIEW_REQUESTED"],
        policySnapshot: {
          minimumAutoResolveConfidence: 0.95,
          maximumAutoResolveAmountPaise: 100_000,
          amountAtRiskPaise: 286_187,
          confidence: 0.55,
          deterministicEvidenceSupportsClaim: true,
          actionExecutionReady: false,
          highRiskFlags: ["HIGH_SEVERITY"],
        },
      },
    },
    resolutionExecution: null,
  });

  it("includes the exception id, type, and amount", () => {
    expect(html).toContain("463");
    expect(html).toContain("UNKNOWN_ADJUSTMENT");
    expect(html).toContain("₹2,861.87");
  });

  it("includes every tool call and result from the trace, in order", () => {
    expect(html).toContain("get_adjustment");
    expect(html.indexOf("Called")).toBeLessThan(html.indexOf("Result"));
  });

  it("includes the root cause, confidence, and recommended action", () => {
    expect(html).toContain("unknown_adjustment");
    expect(html).toContain("55%");
    expect(html).toContain("create_review_case");
    expect(html).toContain("adjustment:100");
  });

  it("includes the policy decision", () => {
    expect(html).toContain("Review case #7 created.");
    expect(html).toContain("Resolution controls");
    expect(html).toContain("human_review");
    expect(html).toContain("MODEL_REQUIRES_APPROVAL");
    expect(html).toContain("SUPPORTED_UNKNOWN_ADJUSTMENT");
    expect(html).toContain("ACTION_REQUIRES_HUMAN_WORKFLOW");
    expect(html).toContain("HIGH_SEVERITY");
    expect(html).toContain("Not executed");
  });

  it("is well-formed enough to be a complete HTML document", () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("</html>");
  });

  it("escapes exception summary content rather than injecting it raw", () => {
    const withHtml: ExceptionRecord = { ...exception, summary: "<script>alert(1)</script>" };
    const escaped = renderEvidencePage({
      exception: withHtml,
      steps: [],
      outcome: { status: "ai_error", reason: "test", rawResponse: "" },
      policyDecision: "test",
    });
    expect(escaped).not.toContain("<script>alert(1)</script>");
    expect(escaped).toContain("&lt;script&gt;");
  });
});

describe("renderEvidencePage — AI_ERROR outcome", () => {
  const html = renderEvidencePage({
    exception,
    steps,
    outcome: { status: "ai_error", reason: "schema validation failed: missing rootCause", rawResponse: "not valid json" },
    policyDecision: "Opened a review case for manual investigation.",
  });

  it("clearly labels the AI_ERROR rather than showing a blank or fabricated result section", () => {
    expect(html).toContain("AI_ERROR");
    expect(html).toContain("schema validation failed");
  });

  it("does not render a result card claiming a root cause that was never validated", () => {
    expect(html).not.toContain("Root cause</dt>");
  });
});
