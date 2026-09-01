import { describe, expect, it, vi } from "vitest";
import type { InvestigationOutcome, InvestigationResult } from "../src/agent/schema.js";
import type { ExceptionRecord } from "../src/db/schema.js";
import { executeResolution } from "../src/policy/execute-resolution.js";

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
  deterministicEvidenceJson: {
    settlementId: 2,
    correctFeePaise: 100,
    reportedFeePaise: 120,
    correctTaxPaise: 18,
    reportedTaxPaise: 22,
  },
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

function completed(result: InvestigationResult = investigation): InvestigationOutcome {
  return { status: "completed", result };
}

describe("executeResolution", () => {
  it("dispatches the exact deterministic plan after recomputing all gates", async () => {
    const execute = vi.fn(async () => ({ runId: 12 }));

    const execution = await executeResolution({ exception, outcome: completed(), execute });

    expect(execution).toMatchObject({
      status: "executed",
      plan: { action: "rerun_reconciliation", exceptionId: 10, reconciliationRunId: 4 },
      result: { runId: 12 },
      decision: { policy: { decision: "auto_resolve" } },
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("never dispatches a human-review decision", async () => {
    const execute = vi.fn();
    const execution = await executeResolution({
      exception,
      outcome: completed({ ...investigation, confidence: 0.8 }),
      execute,
    });

    expect(execution).toMatchObject({ status: "denied", decision: { policy: { decision: "human_review" } } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("never dispatches an unresolved AI outcome", async () => {
    const execute = vi.fn();
    const execution = await executeResolution({
      exception,
      outcome: { status: "ai_error", reason: "timeout", rawResponse: "" },
      execute,
    });

    expect(execution).toMatchObject({
      status: "denied",
      decision: { policy: { decision: "unresolved", reasons: ["AI_ERROR"] } },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rechecks current exception state instead of trusting an earlier eligible decision", async () => {
    const execute = vi.fn();
    const execution = await executeResolution({
      exception: { ...exception, status: "RESOLVED", resolvedAt: new Date("2026-09-01T01:00:00Z") },
      outcome: completed(),
      execute,
    });

    expect(execution).toMatchObject({
      status: "denied",
      decision: {
        policy: {
          decision: "human_review",
          policySnapshot: { highRiskFlags: ["ALREADY_RESOLVED", "EXCEPTION_NOT_OPEN"] },
        },
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("propagates handler failures without reporting an executed result", async () => {
    const failure = new Error("database transaction failed");
    await expect(executeResolution({
      exception,
      outcome: completed(),
      execute: async () => { throw failure; },
    })).rejects.toBe(failure);
  });
});
