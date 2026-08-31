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
  exceptionId: z.number().int().positive(),
  rootCause: z.enum([
    "duplicate_refund",
    "missing_refund_link",
    "fee_mismatch",
    "unknown_adjustment",
    "missing_bank_credit",
    "timing_difference",
    "ambiguous_match",
    "insufficient_evidence",
    "other",
  ]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    recordId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })).min(1, "cite at least one evidence record"),
  recommendedAction: z.enum([
    "link_record",
    "reclassify",
    "rerun_reconciliation",
    "create_review_case",
    "propose_adjustment",
    "no_action",
  ]),
  requiresHumanApproval: z.boolean(),
  explanation: z.string().min(1, "explanation must not be empty"),
}).strict();

export type InvestigationResult = z.infer<typeof investigationResultSchema>;

export type InvestigationOutcome =
  | { status: "completed"; result: InvestigationResult }
  | { status: "ai_error"; reason: string; rawResponse: string };
