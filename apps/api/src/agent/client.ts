/** Provider adapters for SettleGuard's model-agnostic agent loop. */

import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, ModelCaller, ModelMessage } from "./loop.js";

export type AgentProvider = "anthropic" | "gemini";

let anthropicClient: Anthropic | null = null;
let geminiToolCallSequence = 0;

export function configuredAgentProvider(): AgentProvider {
  const provider = (process.env.SETTLEGUARD_AGENT_PROVIDER ?? "anthropic").trim().toLowerCase();
  if (provider === "anthropic" || provider === "gemini") return provider;
  throw new Error(`Unsupported SETTLEGUARD_AGENT_PROVIDER "${provider}". Use anthropic or gemini.`);
}

export function configuredAgentModel(provider = configuredAgentProvider()): string {
  const configured = process.env.SETTLEGUARD_AGENT_MODEL?.trim();
  return configured || (provider === "gemini" ? "gemini-3.6-flash" : "claude-sonnet-5");
}

export function assertAnthropicConfigured(): void {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Add it to apps/api/.env to use the Anthropic provider.");
}

export function assertGeminiConfigured(): void {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set. Add it to apps/api/.env to use the Gemini provider.");
}

export function assertAgentProviderConfigured(): void {
  if (configuredAgentProvider() === "gemini") assertGeminiConfigured();
  else assertAnthropicConfigured();
}

function getAnthropicClient(): Anthropic {
  assertAnthropicConfigured();
  anthropicClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

export const anthropicCaller: ModelCaller = async ({ system, messages, tools }) => {
  const response = await getAnthropicClient().messages.create({
    model: configuredAgentModel("anthropic"), max_tokens: 2048, system,
    messages: messages as Anthropic.MessageParam[],
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema })),
  });
  return {
    content: response.content.map((block) => {
      if (block.type === "text") return { type: "text" as const, text: block.text };
      if (block.type === "tool_use") return { type: "tool_use" as const, id: block.id, name: block.name, input: block.input as Record<string, unknown> };
      return { type: "text" as const, text: "" };
    }),
    stop_reason: response.stop_reason ?? "end_turn",
  };
};

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  error?: { message?: string };
}

function parseToolResult(content: string): unknown {
  try { return JSON.parse(content); } catch { return content; }
}

function geminiContents(messages: ModelMessage[]): Array<{ role: "user" | "model"; parts: GeminiPart[] }> {
  const toolNamesById = new Map<string, string>();
  return messages.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] };
    }
    const parts = message.content.map((block): GeminiPart => {
      if (block.type === "tool_result") {
        const name = toolNamesById.get(block.tool_use_id);
        if (!name) throw new Error(`Cannot map Gemini tool result ${block.tool_use_id} to a function name.`);
        return { functionResponse: { name, response: { result: parseToolResult(block.content) } } };
      }
      if (block.type === "tool_use") {
        if (!block.id || !block.name) throw new Error("Cannot send a malformed tool call to Gemini.");
        toolNamesById.set(block.id, block.name);
        return { functionCall: { name: block.name, args: block.input ?? {} }, thoughtSignature: block.thoughtSignature };
      }
      return { text: block.text ?? "" };
    });
    return { role: message.role === "assistant" ? "model" : "user", parts };
  });
}

export const geminiCaller: ModelCaller = async ({ system, messages, tools }) => {
  assertGeminiConfigured();
  const model = configuredAgentModel("gemini");
  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: geminiContents(messages),
      tools: [{ functionDeclarations: tools.map((tool) => {
        // Gemini's function-schema subset rejects this otherwise useful JSON Schema keyword.
        const { additionalProperties: _additionalProperties, ...parameters } = tool.input_schema;
        return { name: tool.name, description: tool.description, parameters };
      }) }],
      generationConfig: { maxOutputTokens: 2048 },
    }),
  };
  let response!: Response;
  let payload!: GeminiResponse;
  for (let attempt = 0; attempt < 5; attempt++) {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, request);
    payload = await response.json() as GeminiResponse;
    const transientStatus = response.status === 429 || [500, 502, 503, 504].includes(response.status);
    if (!transientStatus || attempt === 4) break;
    const retryHeaderValue = response.headers.get("retry-after");
    const retryHeader = retryHeaderValue === null ? Number.NaN : Number(retryHeaderValue);
    const retryMessage = payload.error?.message?.match(/retry in ([\d.]+)s/i)?.[1];
    const delayMs = Number.isFinite(retryHeader) && retryHeader >= 0
      ? retryHeader * 1_000
      : Math.max(2_000, Number(retryMessage ?? 0) * 1_000, 2 ** attempt * 2_000);
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 30_000)));
  }
  if (!response.ok) throw new Error(`Gemini API request failed (${response.status}): ${payload.error?.message ?? response.statusText}`);
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const content: ContentBlock[] = [];
  for (const part of parts) {
    if (typeof part.text === "string") content.push({ type: "text", text: part.text });
    else if (part.functionCall?.name) {
      geminiToolCallSequence += 1;
      content.push({
        type: "tool_use",
        id: `gemini-tool-${geminiToolCallSequence}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
        thoughtSignature: part.thoughtSignature,
      });
    }
  }
  return { content, stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn" };
};

export const configuredModelCaller: ModelCaller = async (params) =>
  configuredAgentProvider() === "gemini" ? geminiCaller(params) : anthropicCaller(params);
