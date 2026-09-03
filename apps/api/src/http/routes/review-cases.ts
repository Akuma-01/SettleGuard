import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { approveReviewCase } from "../../policy/approve-review.js";
import { decideReviewCase } from "../../policy/review-decision.js";
import type { ApiErrorBody } from "../app.js";
import { parsePositiveId } from "../params.js";

const reviewerSchema = z.object({
  reviewerId: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1).max(2_000),
}).strict();
const rejectSchema = reviewerSchema.extend({
  decision: z.enum(["reject", "mark_unresolved"]).default("reject"),
}).strict();

function invalidReviewId(reply: FastifyReply) {
  return reply.code(400).send({ error: { code: "INVALID_REVIEW_CASE_ID", message: "Review case id must be a positive integer" } } satisfies ApiErrorBody);
}

function reviewError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("No review case")) return reply.code(404).send({ error: { code: "REVIEW_CASE_NOT_FOUND", message } } satisfies ApiErrorBody);
  if (message.includes("already been decided") || message.includes("changed while")) {
    return reply.code(409).send({ error: { code: "REVIEW_CASE_CONFLICT", message } } satisfies ApiErrorBody);
  }
  if (message.includes("not executable") || message.includes("not implemented") || message.includes("No validated investigation")) {
    return reply.code(422).send({ error: { code: "REVIEW_ACTION_NOT_EXECUTABLE", message } } satisfies ApiErrorBody);
  }
  throw error;
}

export async function registerReviewCaseRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string }; Body: unknown }>("/api/review-cases/:id/approve", async (request, reply) => {
    const reviewCaseId = parsePositiveId(request.params.id);
    if (reviewCaseId === null) return invalidReviewId(reply);
    const input = reviewerSchema.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send({ error: { code: "INVALID_REVIEW_DECISION", message: "Approval requires reviewerId and note" } } satisfies ApiErrorBody);
    }
    try {
      return { review: await approveReviewCase(reviewCaseId, input.data) };
    } catch (error) {
      return reviewError(reply, error);
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/review-cases/:id/reject", async (request, reply) => {
    const reviewCaseId = parsePositiveId(request.params.id);
    if (reviewCaseId === null) return invalidReviewId(reply);
    const input = rejectSchema.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send({ error: { code: "INVALID_REVIEW_DECISION", message: "Rejection requires reviewerId, note, and an optional valid decision" } } satisfies ApiErrorBody);
    }
    try {
      return { review: await decideReviewCase(reviewCaseId, input.data) };
    } catch (error) {
      return reviewError(reply, error);
    }
  });
}
