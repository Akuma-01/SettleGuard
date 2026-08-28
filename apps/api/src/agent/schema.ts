/**
 * SettleGuard — Phase 4, Step 4: structured output + validation.
 *
 * Every investigation ends with exactly this shape, Zod-validated —
 * never a fabricated result. If the model's final response isn't
 * valid JSON matching this schema, the loop sends one repair message
 * and tries again; if it still fails, the investigation resolves to
 * an AI_ERROR result rather than pretending something usable came
 * back. An agent correctly reporting "I don't have enough evidence"
 * is a valid, successful investigation — see recommendedAction below.
 */

import { z } from "zod";

export const investigationResultSchema = z.object({
  rootCause: z.string().min(1, "rootCause must not be empty"),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string()).min(1, "cite at least one piece of evidence gathered"),
  recommendedAction: z.enum(["auto_resolve", "human_review", "unresolved"]),
  requiresHumanApproval: z.boolean(),
  explanation: z.string().min(1, "explanation must not be empty"),
});

export type InvestigationResult = z.infer<typeof investigationResultSchema>;

export type InvestigationOutcome =
  | { status: "completed"; result: InvestigationResult }
  | { status: "ai_error"; reason: string; rawResponse: string };
