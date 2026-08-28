/**
 * SettleGuard — Phase 4, Steps 3-4: the tool-calling loop, plus
 * structured-output validation with one repair retry.
 *
 * The model caller is an injected function, not a direct Anthropic
 * SDK call — this file never imports the SDK. That's deliberate: it
 * means the entire loop (tool execution, message threading, the
 * step cap, the repair-retry-then-AI_ERROR path) is unit-testable
 * with a scripted fake model, with no API key and no network call.
 * The real Anthropic-backed caller lives in client.ts, used only by
 * the CLI.
 */

import { investigationResultSchema, type InvestigationOutcome } from "./schema.js";
import type { ToolDefinition } from "./tools.js";

export interface ContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export interface ModelMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[] | ToolResultBlock[];
}

export interface ModelResponse {
  content: ContentBlock[];
  stop_reason: string;
}

export type ModelCaller = (params: { system: string; messages: ModelMessage[]; tools: ToolDefinition[] }) => Promise<ModelResponse>;
export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<unknown>;

export type AgentStep =
  | { type: "tool_call"; toolName: string; toolInput: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; toolOutput: unknown }
  | { type: "final_text"; text: string };

const MAX_TOOL_STEPS = 8;

export interface LoopResult {
  steps: AgentStep[];
  finalText: string | null;
  hitStepCap: boolean;
  messages: ModelMessage[]; // full history — needed so a repair retry can continue the same conversation
}

/** The raw tool-calling loop: calls the model, executes any tool_use blocks, feeds results back, repeats until the model stops calling tools or the step cap is hit. */
export async function runAgentLoop(
  system: string,
  initialUserMessage: string,
  tools: ToolDefinition[],
  callModel: ModelCaller,
  executeTool: ToolExecutor,
): Promise<LoopResult> {
  const messages: ModelMessage[] = [{ role: "user", content: initialUserMessage }];
  const steps: AgentStep[] = [];

  for (let i = 0; i < MAX_TOOL_STEPS; i++) {
    const response = await callModel({ system, messages, tools });
    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter((b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use");

    if (toolUseBlocks.length === 0 || response.stop_reason !== "tool_use") {
      const textBlock = response.content.find((b) => b.type === "text");
      const finalText = textBlock?.text ?? null;
      if (finalText) steps.push({ type: "final_text", text: finalText });
      return { steps, finalText, hitStepCap: false, messages };
    }

    const toolResults: ToolResultBlock[] = [];
    for (const block of toolUseBlocks) {
      const toolName = block.name!;
      const toolInput = block.input ?? {};
      steps.push({ type: "tool_call", toolName, toolInput });
      const output = await executeTool(toolName, toolInput);
      steps.push({ type: "tool_result", toolName, toolOutput: output });
      toolResults.push({ type: "tool_result", tool_use_id: block.id!, content: JSON.stringify(output) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { steps, finalText: null, hitStepCap: true, messages };
}

function tryParse(text: string): { success: true; data: unknown } | { success: false; error: string } {
  // Models occasionally wrap JSON in ```json fences despite instructions not to — strip them before parsing rather than failing on a cosmetic wrapper.
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return { success: true, data: JSON.parse(stripped) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs the loop, then validates the final answer against InvestigationResult — one repair retry on invalid JSON/schema, then an honest AI_ERROR rather than a fabricated result. */
export async function runAgentLoopWithValidation(
  system: string,
  initialUserMessage: string,
  tools: ToolDefinition[],
  callModel: ModelCaller,
  executeTool: ToolExecutor,
): Promise<{ outcome: InvestigationOutcome; steps: AgentStep[] }> {
  const loopResult = await runAgentLoop(system, initialUserMessage, tools, callModel, executeTool);

  if (loopResult.hitStepCap) {
    return {
      outcome: { status: "ai_error", reason: `Hit the ${MAX_TOOL_STEPS}-tool-call cap without a final answer`, rawResponse: "" },
      steps: loopResult.steps,
    };
  }

  const attempt = validateFinalText(loopResult.finalText);
  if (attempt.status === "completed") return { outcome: attempt, steps: loopResult.steps };

  // One repair retry, continuing the same conversation.
  const repairMessages: ModelMessage[] = [
    ...loopResult.messages,
    {
      role: "user",
      content: `Your previous response was not valid JSON matching the required schema. Error: ${attempt.reason}. Respond with ONLY the corrected JSON object — no markdown fences, no other text.`,
    },
  ];
  const repairResponse = await callModel({ system, messages: repairMessages, tools });
  const repairText = repairResponse.content.find((b) => b.type === "text")?.text ?? "";
  if (repairText) loopResult.steps.push({ type: "final_text", text: repairText });

  const repairAttempt = validateFinalText(repairText);
  return { outcome: repairAttempt, steps: loopResult.steps };
}

function validateFinalText(text: string | null): InvestigationOutcome {
  if (!text) return { status: "ai_error", reason: "model produced no final text response", rawResponse: "" };
  const parsed = tryParse(text);
  if (!parsed.success) return { status: "ai_error", reason: `not valid JSON: ${parsed.error}`, rawResponse: text };
  const validated = investigationResultSchema.safeParse(parsed.data);
  if (!validated.success) return { status: "ai_error", reason: `schema validation failed: ${validated.error.message}`, rawResponse: text };
  return { status: "completed", result: validated.data };
}
