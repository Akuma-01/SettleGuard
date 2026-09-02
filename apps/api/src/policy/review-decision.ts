/** Human review transitions that do not execute a proposed resolution action. */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { auditLogs, exceptions, reviewCases } from "../db/schema.js";

const reviewDecisionInputSchema = z.object({
  decision: z.enum(["reject", "mark_unresolved"]),
  reviewerId: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1).max(2_000),
}).strict();

export type ReviewDecisionInput = z.infer<typeof reviewDecisionInputSchema>;

export interface ReviewDecisionResult {
  reviewCaseId: number;
  exceptionId: number;
  decision: ReviewDecisionInput["decision"];
  applied: boolean;
  exceptionStatus: string;
}

export async function decideReviewCase(reviewCaseId: number, input: ReviewDecisionInput): Promise<ReviewDecisionResult> {
  if (!Number.isInteger(reviewCaseId) || reviewCaseId <= 0) throw new Error("reviewCaseId must be a positive integer");
  const parsed = reviewDecisionInputSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid review decision: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`);

  const [reviewCase] = await db.select().from(reviewCases).where(eq(reviewCases.id, reviewCaseId));
  if (!reviewCase) throw new Error(`No review case with id ${reviewCaseId}`);
  const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, reviewCase.exceptionId));
  if (!exception) throw new Error(`No exception with id ${reviewCase.exceptionId}`);

  if (reviewCase.status !== "pending") {
    if (reviewCase.reviewerDecision === parsed.data.decision && reviewCase.reviewerNote === parsed.data.note) {
      return {
        reviewCaseId,
        exceptionId: exception.id,
        decision: parsed.data.decision,
        applied: false,
        exceptionStatus: exception.status,
      };
    }
    throw new Error(`Review case ${reviewCaseId} has already been decided`);
  }
  if (parsed.data.decision === "mark_unresolved" && (exception.status !== "OPEN" || exception.resolvedAt !== null)) {
    throw new Error(`Exception ${exception.id} cannot be marked unresolved from status ${exception.status}`);
  }

  const exceptionStatus = parsed.data.decision === "mark_unresolved" ? "UNRESOLVED" : exception.status;
  const reviewedAt = new Date();
  await db.transaction(async (tx) => {
    const updated = await tx.update(reviewCases).set({
      status: parsed.data.decision === "reject" ? "rejected" : "completed",
      reviewerDecision: parsed.data.decision,
      reviewerNote: parsed.data.note,
      reviewedAt,
    }).where(and(eq(reviewCases.id, reviewCaseId), eq(reviewCases.status, "pending"))).returning({ id: reviewCases.id });
    if (updated.length !== 1) throw new Error(`Review case ${reviewCaseId} changed while the decision was being applied`);

    if (parsed.data.decision === "mark_unresolved") {
      await tx.update(exceptions).set({ status: exceptionStatus }).where(eq(exceptions.id, exception.id));
    }
    await tx.insert(auditLogs).values({
      actorType: "human",
      actorId: parsed.data.reviewerId,
      action: `review_${parsed.data.decision}`,
      entityType: "review_case",
      entityId: reviewCaseId,
      beforeJson: { reviewStatus: reviewCase.status, exceptionStatus: exception.status },
      afterJson: { reviewStatus: parsed.data.decision === "reject" ? "rejected" : "completed", exceptionStatus },
      metadataJson: { exceptionId: exception.id, note: parsed.data.note },
    });
  });

  return { reviewCaseId, exceptionId: exception.id, decision: parsed.data.decision, applied: true, exceptionStatus };
}
