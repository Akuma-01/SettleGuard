import { describe, expect, it, vi } from "vitest";
import { runAgentLoop, runAgentLoopWithValidation, type ModelCaller, type ModelResponse } from "../src/agent/loop.js";
import type { ToolDefinition } from "../src/agent/tools.js";

const dummyTools: ToolDefinition[] = [{ name: "get_thing", description: "test tool", input_schema: { type: "object", properties: {}, required: [] } }];

function textResponse(text: string): ModelResponse {
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}
function toolUseResponse(name: string, input: Record<string, unknown>, id = "tool_1"): ModelResponse {
  return { content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" };
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
    expect(caller).toHaveBeenCalledTimes(8); // MAX_TOOL_STEPS
  });
});

describe("runAgentLoopWithValidation — structured output + repair retry", () => {
  it("returns a completed outcome for a valid first response", async () => {
    const valid = JSON.stringify({
      rootCause: "test",
      confidence: 0.8,
      evidence: ["fact one"],
      recommendedAction: "human_review",
      requiresHumanApproval: true,
      explanation: "test explanation",
    });
    const caller: ModelCaller = vi.fn().mockResolvedValueOnce(textResponse(valid));
    const executeTool = vi.fn();

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, executeTool);

    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") expect(outcome.result.rootCause).toBe("test");
  });

  it("strips markdown fences before parsing, since models sometimes add them despite instructions not to", async () => {
    const valid = '```json\n' + JSON.stringify({
      rootCause: "test", confidence: 0.5, evidence: ["x"], recommendedAction: "unresolved", requiresHumanApproval: true, explanation: "y",
    }) + '\n```';
    const caller: ModelCaller = vi.fn().mockResolvedValueOnce(textResponse(valid));

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, vi.fn());

    expect(outcome.status).toBe("completed");
  });

  it("retries once on invalid JSON and succeeds if the repair response is valid", async () => {
    const valid = JSON.stringify({
      rootCause: "fixed", confidence: 0.7, evidence: ["x"], recommendedAction: "human_review", requiresHumanApproval: true, explanation: "y",
    });
    const caller: ModelCaller = vi
      .fn()
      .mockResolvedValueOnce(textResponse("not valid json at all"))
      .mockResolvedValueOnce(textResponse(valid));

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, vi.fn());

    expect(caller).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe("completed");
    if (outcome.status === "completed") expect(outcome.result.rootCause).toBe("fixed");
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

  it("returns AI_ERROR when the step cap is hit, without attempting to validate a nonexistent final answer", async () => {
    const caller: ModelCaller = vi.fn().mockResolvedValue(toolUseResponse("get_thing", {}));
    const executeTool = vi.fn().mockResolvedValue({});

    const { outcome } = await runAgentLoopWithValidation("system", "investigate", dummyTools, caller, executeTool);

    expect(outcome.status).toBe("ai_error");
    if (outcome.status === "ai_error") expect(outcome.reason).toMatch(/tool-call cap/);
  });
});
