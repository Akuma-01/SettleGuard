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
    expect(configuredAgentModel()).toBe("gemini-3.6-flash");
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
      candidates: [{ content: { parts: [{ functionCall: { name: "get_exception", args: { exceptionId: 42 } }, thoughtSignature: "opaque-signature" }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await geminiCaller({ system: "Stay grounded.", messages: [{ role: "user", content: "Investigate 42" }], tools });

    expect(response).toMatchObject({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "get_exception", input: { exceptionId: 42 }, thoughtSignature: "opaque-signature" }],
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("gemini-2.5-flash:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body);
    expect(body.systemInstruction.parts[0].text).toBe("Stay grounded.");
    expect(body.tools[0].functionDeclarations[0]).toMatchObject({
      name: "get_exception",
      parameters: { type: "object", properties: tools[0]!.input_schema.properties, required: ["exceptionId"] },
    });
    expect(body.tools[0].functionDeclarations[0].parameters).not.toHaveProperty("additionalProperties");
  });

  it("maps tool results back to Gemini function responses", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const messages: ModelMessage[] = [
      { role: "user", content: "Investigate 42" },
      { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "get_exception", input: { exceptionId: 42 }, thoughtSignature: "opaque-signature" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "{\"id\":42}" }] },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "{\"exceptionId\":42}" }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await geminiCaller({ system: "Stay grounded.", messages, tools });

    expect(response).toEqual({ content: [{ type: "text", text: "{\"exceptionId\":42}" }], stop_reason: "end_turn" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.contents[1].parts[0].thoughtSignature).toBe("opaque-signature");
    expect(body.contents[2]).toEqual({ role: "user", parts: [{ functionResponse: { name: "get_exception", response: { result: { id: 42 } } } }] });
  });

  it("retries a free-tier rate limit response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const rateLimited = new Response(JSON.stringify({ error: { message: "Please retry in 0s." } }), {
      status: 429, headers: { "Content-Type": "application/json", "retry-after": "0" },
    });
    const success = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "done" }] } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(rateLimited).mockResolvedValueOnce(success);
    vi.stubGlobal("fetch", fetchMock);
    await expect(geminiCaller({ system: "", messages: [], tools: [] })).resolves.toMatchObject({ stop_reason: "end_turn" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transient provider-capacity response", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const unavailable = new Response(JSON.stringify({ error: { message: "High demand" } }), {
      status: 503, headers: { "Content-Type": "application/json", "retry-after": "0" },
    });
    const success = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "done" }] } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(success);
    vi.stubGlobal("fetch", fetchMock);
    await expect(geminiCaller({ system: "", messages: [], tools: [] })).resolves.toMatchObject({ stop_reason: "end_turn" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails before the network call when the Gemini key is absent", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(geminiCaller({ system: "", messages: [], tools: [] })).rejects.toThrow(/GEMINI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
