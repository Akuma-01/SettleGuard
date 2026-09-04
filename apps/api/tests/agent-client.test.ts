import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredAgentModel, configuredAgentProvider, geminiCaller } from "../src/agent/client.js";
import type { ModelMessage } from "../src/agent/loop.js";
import type { ToolDefinition } from "../src/agent/tools.js";

const originalEnv = { ...process.env };

const tools: ToolDefinition[] = [{
  name: "get_exception",
  description: "Fetch an exception",
  input_schema: {
    type: "object",
    properties: { exceptionId: { type: "integer", description: "Exception ID" } },
    required: ["exceptionId"],
    additionalProperties: false,
  },
}];

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("agent provider configuration", () => {
  it("selects Gemini and its free-tier-friendly default model", () => {
    process.env.SETTLEGUARD_AGENT_PROVIDER = "gemini";
    process.env.SETTLEGUARD_AGENT_MODEL = "";
    expect(configuredAgentProvider()).toBe("gemini");
    expect(configuredAgentModel()).toBe("gemini-2.5-flash");
  });

  it("rejects an unsupported provider", () => {
    process.env.SETTLEGUARD_AGENT_PROVIDER = "unknown";
    expect(() => configuredAgentProvider()).toThrow(/Unsupported SETTLEGUARD_AGENT_PROVIDER/);
  });
});

describe("geminiCaller", () => {
  it("translates system instructions, tools, and function calls", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.SETTLEGUARD_AGENT_MODEL = "gemini-2.5-flash";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ functionCall: { name: "get_exception", args: { exceptionId: 42 } } }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await geminiCaller({ system: "Stay grounded.", messages: [{ role: "user", content: "Investigate 42" }], tools });

    expect(response).toMatchObject({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "get_exception", input: { exceptionId: 42 } }],
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("gemini-2.5-flash:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe("Stay grounded.");
    expect(body.tools[0].functionDeclarations[0]).toMatchObject({ name: "get_exception", parameters: tools[0]!.input_schema });
  });

  it("maps tool results back to Gemini function responses", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const messages: ModelMessage[] = [
      { role: "user", content: "Investigate 42" },
      { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "get_exception", input: { exceptionId: 42 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "{\"id\":42}" }] },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{\"exceptionId\":42}" }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await geminiCaller({ system: "Stay grounded.", messages, tools });

    expect(response).toEqual({ content: [{ type: "text", text: "{\"exceptionId\":42}" }], stop_reason: "end_turn" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.contents[2]).toEqual({ role: "user", parts: [{ functionResponse: { name: "get_exception", response: { result: { id: 42 } } } }] });
  });

  it("fails before the network call when the Gemini key is absent", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(geminiCaller({ system: "", messages: [], tools: [] })).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
