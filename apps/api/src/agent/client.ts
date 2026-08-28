/**
 * SettleGuard — Phase 4: the real model caller.
 * The only file in src/agent/ that imports the Anthropic SDK — every
 * other piece (loop.ts, tools.ts, schema.ts) is testable without it.
 * Requires ANTHROPIC_API_KEY; fails loudly and immediately if unset
 * rather than making a doomed network call.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ModelCaller } from "./loop.js";

const MODEL = process.env.SETTLEGUARD_AGENT_MODEL ?? "claude-sonnet-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to apps/api/.env to run a real investigation.");
  }
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export const anthropicCaller: ModelCaller = async ({ system, messages, tools }) => {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system,
    // The SDK's message/content types are broader than our minimal
    // internal shapes but structurally compatible for what we send.
    messages: messages as Anthropic.MessageParam[],
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
  });

  return {
    content: response.content.map((block) => {
      if (block.type === "text") return { type: "text" as const, text: block.text };
      if (block.type === "tool_use") return { type: "tool_use" as const, id: block.id, name: block.name, input: block.input as Record<string, unknown> };
      return { type: "text" as const, text: "" }; // other block types not expected in this text+tool_use-only flow
    }),
    stop_reason: response.stop_reason ?? "end_turn",
  };
};
