import { describe, expect, it } from "vitest";
import { extractObservedRecordIds } from "../src/agent/evidence-grounding.js";
import type { AgentStep } from "../src/agent/loop.js";

describe("extractObservedRecordIds", () => {
  it("extracts IDs from direct record tools and exception primary records", () => {
    const steps: AgentStep[] = [
      { type: "tool_result", toolName: "get_adjustment", toolOutput: { id: 7, settlementId: 3 } },
      { type: "tool_result", toolName: "get_exception", toolOutput: { id: 9, primaryRecordType: "refund", primaryRecordId: 12 } },
    ];
    expect(extractObservedRecordIds(steps)).toEqual(new Set(["adjustment:7", "settlement:3", "exception:9", "refund:12"]));
  });

  it("extracts IDs from related-record collections and analysis results", () => {
    const steps: AgentStep[] = [
      { type: "tool_result", toolName: "get_related_payments", toolOutput: { payments: [{ id: 1 }, { id: 2 }] } },
      { type: "tool_result", toolName: "score_candidate_match", toolOutput: { settlementId: 4, bankTransactionId: 5, score: 75 } },
      { type: "tool_result", toolName: "calculate_expected_fees", toolOutput: { paymentIds: [1, 2] } },
    ];
    expect(extractObservedRecordIds(steps)).toEqual(new Set(["payment:1", "payment:2", "settlement:4", "bank_transaction:5"]));
  });

  it("ignores arbitrary numeric fields and failed tool output", () => {
    const steps: AgentStep[] = [
      { type: "tool_result", toolName: "get_payment", toolOutput: { error: "not found", amountPaise: 999_999 } },
      { type: "tool_result", toolName: "unknown", toolOutput: { score: 100, count: 8 } },
    ];
    expect(extractObservedRecordIds(steps).size).toBe(0);
  });
});
