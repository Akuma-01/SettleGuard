import { describe, expect, it, vi } from "vitest";
import { MAX_TOOL_CALLS, runAgentLoop, runAgentLoopWithValidation, type ModelCaller, type ModelResponse } from "../src/agent/loop.js";
import type { ToolDefinition } from "../src/agent/tools.js";

const dummyTools: ToolDefinition[] = [{ name: "get_thing", description: "test tool", input_schema: { type: "object", properties: {}, required: [] } }];

function textResponse(text: string): ModelResponse {
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}
function toolUseResponse(name: string, input: Record<string, unknown>, id = "tool_1"): ModelResponse {
  return { content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" };
}
function validResult(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    exceptionId: 42,
    rootCause: "unknown_adjustment",
    confidence: 0.8,
    evidence: [{ recordId: "adjustment:100", reason: "Verified source reference is absent." }],
    recommendedAction: "create_review_case",
    requiresHumanApproval: true,
    explanation: "A reviewer should verify the source system.",
    ...overrides,
  });
}

describe("runAgentLoop — basic control flow", () => {
  it("calls a tool once, then returns a final answer with no more tool calls", async () => {
    const caller: ModelCaller = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("get_thing", { id: 1 }))
      .mockResolvedValueOnce(textResponse('{"done": true}'));
    const executeTool = vi.fn().mockResolvedValue({ thing: "value" });

    const result = await runAgentLoop("system", "investigate", dummyTools, caller, executeTool);

    expect(result.hitStepCap).toBe(false);
    expect(result.finalText).toBe('{"done": true}');
    expect(executeTool).toHaveBeenCalledWith("get_thing", { id: 1 });
    expect(result.steps.map((s) => s.type)).toEqual(["tool_call", "tool_result", "final_text"]);
  });

  it("chains multiple tool calls across separate rounds before the final answer", async () => {
    const caller: ModelCaller = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("get_thing", { id: 1 }, "t1"))
      .mockResolvedValueOnce(toolUseResponse("get_thing", { id: 2 }, "t2"))
      .mockResolvedValueOnce(textResponse('{"done": true}'));
    const executeTool = vi.fn().mockResolvedValue({});

    const result = await runAgentLoop("system", "investigate", dummyTools, caller, executeTool);

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe('{"done": true}');
  });

  it("executes multiple parallel tool_use blocks from a single response and returns all results together", async () => {
    const parallelResponse: ModelResponse = {
      content: [
        { type: "tool_use", id: "a", name: "get_thing", input: { id: 1 } },
        { type: "tool_use", id: "b", name: "get_thing", input: { id: 2 } },
      ],
      stop_reason: "tool_use",
    };
    const caller: ModelCaller = vi.fn().mockResolvedValueOnce(parallelResponse).mockResolvedValueOnce(textResponse('{"done": true}'));
    const executeTool = vi.fn().mockResolvedValue({});

    const result = await runAgentLoop("system", "investigate", dummyTools, caller, executeTool);

    expect(executeTool).toHaveBeenCalledTimes(2);
    // Both tool_result blocks must land in the SAME user message, not two separate ones.
    const toolResultMessage = result.messages.find((m) => Array.isArray(m.content) && m.content[0] && "tool_use_id" in m.content[0]);
    expect((toolResultMessage!.content as any[]).length).toBe(2);
  });

  it("stops at the step cap if the model never stops calling tools, rather than looping forever", async () => {
    const caller: ModelCaller = vi.fn().mockResolvedValue(toolUseResponse("get_thing", { id: 1 }));
    const executeTool = vi.fn().mockResolvedValue({});

    const result = await runAgentLoop("system", "investigate", dummyTools, caller, executeTool);

    expect(result.hitStepCap).toBe(true);
    expect(result.finalText).toBeNull();
    expect(executeTool).toHaveBeenCalledTimes(MAX_TOOL_CALLS);
    // One final model turn is allowed after the eighth executed tool so it
    // can answer; requesting a ninth tool is what trips the cap.
    expect(caller).toHaveBeenCalledTimes(MAX_TOOL_CALLS + 1);
  });

  it("does not partially execute a parallel batch that would exceed the exact call budget", async () => {
    let call = 0;
    const caller: ModelCaller = vi.fn(async (): Promise<ModelResponse> => {
      call++;
      if (call <= MAX_TOOL_CALLS - 1) return toolUseResponse("get_thing", { id: call }, `t${call}`);
      return {
        content: [
          { type: "tool_use", id: "overflow-a", name: "get_thing", input: { id: 8 } },
          { type: "tool_use", id: "overflow-b", name: "get_thing", input: { id: 9 } },
        ],
        stop_reason: "tool_use",
      };
    });
    const executeTool = vi.fn().mockResolvedValue({});

    const result = await runAgentLoop("system", "investigate", dummyTools, caller, executeTool);

    expect(result.hitStepCap).toBe(true);
    expect(executeTool).toHaveBeenCalledTimes(MAX_TOOL_CALLS - 1);
  });

  it("feeds a thrown tool error back as an observation and lets the model recover", async () => {
    const caller: ModelCaller = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("get_thing", {}))
      .mockResolvedValueOnce(textResponse('{"done":true}'));
    const executeTool = vi.fn().mockRejectedValue(new Error("database temporarily unavailable"));

    const result = await runAgentLoop("system", "investigate", dummyTools, caller, executeTool);

    expect(result.error).toBeNull();
    expect(result.finalText).toBe('{"done":true}');
    expect(result.steps[1]).toMatchObject({ type: "tool_result", toolOutput: { error: expect.stringMatching(/database temporarily unavailable/) } });
  });

  it("returns a controlled error for a malformed tool call instead of using undefined fields", async () => {
    const caller: ModelCaller = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", input: {} }],
      stop_reason: "tool_use",
    });

    const result = await runAgentLoop("system", "investigate", dummyTools, caller, vi.fn());

    expect(result.error).toMatch(/malformed tool call/);
  });

  it("turns model transport failures into a controlled loop result", async () => {
    const caller: ModelCaller = vi.fn().mockRejectedValue(new Error("provider timeout"));
    const result = await runAgentLoop("system", "investigate", dummyTools, caller, vi.fn());
    expect(result.error).toMatch(/Model call failed: provider timeout/);
  });
});

describe("runAgentLoopWithValidation — structured output + repair retry", () => {
  it("returns a completed outcome for a valid first response", async () => {
    const valid = validResult();
    const caller: ModelCaller = vi.fn().mockResolvedValueOnce(textResponse(valid));
    const executeTool = vi.fn();

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, executeTool);

    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") expect(outcome.result.rootCause).toBe("unknown_adjustment");
  });

  it("strips markdown fences before parsing, since models sometimes add them despite instructions not to", async () => {
    const valid = `\`\`\`json\n${validResult({ rootCause: "insufficient_evidence", confidence: 0.5, recommendedAction: "no_action" })}\n\`\`\``;
    const caller: ModelCaller = vi.fn().mockResolvedValueOnce(textResponse(valid));

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, vi.fn());

    expect(outcome.status).toBe("completed");
  });

  it("retries once on invalid JSON and succeeds if the repair response is valid", async () => {
    const valid = validResult({ rootCause: "other", confidence: 0.7 });
    const caller: ModelCaller = vi
      .fn()
      .mockResolvedValueOnce(textResponse("not valid json at all"))
      .mockResolvedValueOnce(textResponse(valid));

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, vi.fn());

    expect(caller).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") expect(outcome.result.rootCause).toBe("other");
  });

  it("returns AI_ERROR — never a fabricated result — if the repair attempt is ALSO invalid", async () => {
    const caller: ModelCaller = vi
      .fn()
      .mockResolvedValueOnce(textResponse("still not json"))
      .mockResolvedValueOnce(textResponse("still not json after repair either"));

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, vi.fn());

    expect(caller).toHaveBeenCalledTimes(2); // exactly one repair attempt, not infinite retries
    expect(outcome.status).toBe("ai_error");
    if (outcome.status === "ai_error") expect(outcome.reason).toMatch(/not valid JSON/);
  });

  it("returns AI_ERROR when valid JSON doesn't match the schema (e.g. missing a required field)", async () => {
    const incomplete = JSON.stringify({ rootCause: "test", confidence: 0.5 }); // missing required fields
    const caller: ModelCaller = vi.fn().mockResolvedValueOnce(textResponse(incomplete)).mockResolvedValueOnce(textResponse(incomplete));

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, vi.fn());

    expect(outcome.status).toBe("ai_error");
    if (outcome.status === "ai_error") expect(outcome.reason).toMatch(/schema validation failed/);
  });

  it("rejects a result for a different exception ID", async () => {
    const caller: ModelCaller = vi.fn()
      .mockResolvedValueOnce(textResponse(validResult({ exceptionId: 99 })))
      .mockResolvedValueOnce(textResponse(validResult({ exceptionId: 99 })));

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, vi.fn(), {
      expectedExceptionId: 42,
      trustedEvidenceRecordIds: ["adjustment:100"],
    });

    expect(outcome.status).toBe("ai_error");
    if (outcome.status === "ai_error") expect(outcome.reason).toMatch(/exceptionId must be 42/);
  });

  it("repairs an evidence citation that was never observed in tool output", async () => {
    const caller: ModelCaller = vi
      .fn()
      .mockResolvedValueOnce(toolUseResponse("get_adjustment", { adjustmentId: 100 }))
      .mockResolvedValueOnce(textResponse(validResult({ evidence: [{ recordId: "adjustment:999", reason: "invented" }] })))
      .mockResolvedValueOnce(textResponse(validResult()));
    const executeTool = vi.fn().mockResolvedValue({ id: 100, sourceReference: null });

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, executeTool, {
      expectedExceptionId: 42,
      trustedEvidenceRecordIds: ["exception:42"],
    });

    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") expect(outcome.result.evidence[0]!.recordId).toBe("adjustment:100");
  });

  it("returns AI_ERROR when the step cap is hit, without attempting to validate a nonexistent final answer", async () => {
    const caller: ModelCaller = vi.fn().mockResolvedValue(toolUseResponse("get_thing", {}));
    const executeTool = vi.fn().mockResolvedValue({});

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, executeTool);

    expect(outcome.status).toBe("ai_error");
    if (outcome.status === "ai_error") expect(outcome.reason).toMatch(/tool-call cap/);
  });

  it("returns AI_ERROR if the one repair call fails at the provider", async () => {
    const caller: ModelCaller = vi
      .fn()
      .mockResolvedValueOnce(textResponse("invalid json"))
      .mockRejectedValueOnce(new Error("repair timeout"));

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, vi.fn());

    expect(outcome.status).toBe("ai_error");
    if (outcome.status === "ai_error") expect(outcome.reason).toMatch(/Repair model call failed: repair timeout/);
  });
});
