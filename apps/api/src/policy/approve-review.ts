/** Approve a review only by rebuilding its deterministic plan from validated output. */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { investigationResultSchema } from "../agent/schema.js";
import { db } from "../db/client.js";
import { exceptions, investigations, reviewCases } from "../db/schema.js";
import { buildActionPlan } from "./action-plan.js";
import { executeLinkRecordAction } from "./link-record-action.js";

const approvalSchema = z.object({
  reviewerId: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1).max(2_000),
}).strict();

export async function approveReviewCase(reviewCaseId: number, input: z.infer<typeof approvalSchema>) {
  if (!Number.isInteger(reviewCaseId) || reviewCaseId <= 0) throw new Error("reviewCaseId must be a positive integer");
  const parsedInput = approvalSchema.safeParse(input);
  if (!parsedInput.success) throw new Error("Approval requires a reviewer identity and note");

  const [reviewCase] = await db.select().from(reviewCases).where(eq(reviewCases.id, reviewCaseId));
  if (!reviewCase) throw new Error(`No review case with id ${reviewCaseId}`);
  if (reviewCase.status !== "pending") {
    if (reviewCase.reviewerDecision === "approve" && reviewCase.reviewerNote === parsedInput.data.note) {
      return { status: "already_approved" as const, reviewCaseId, exceptionId: reviewCase.exceptionId };
    }
    throw new Error(`Review case ${reviewCaseId} has already been decided`);
  }
  const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, reviewCase.exceptionId));
  if (!exception) throw new Error(`No exception with id ${reviewCase.exceptionId}`);

  const rows = await db.select().from(investigations)
    .where(eq(investigations.exceptionId, exception.id))
    .orderBy(desc(investigations.id));
  const investigation = rows
    .map((row) => investigationResultSchema.safeParse(row.structuredOutputJson))
    .find((result) => result.success && result.data.recommendedAction === reviewCase.proposedAction);
  if (!investigation?.success) throw new Error("No validated investigation supports the proposed review action");

  const actionPlan = buildActionPlan(exception, investigation.data);
  if (!actionPlan.ready) throw new Error(`Proposed review action is not executable: ${actionPlan.reason}`);
  if (actionPlan.plan.action !== "link_record") throw new Error(`Review approval is not implemented for ${actionPlan.plan.action}`);

  return executeLinkRecordAction(actionPlan.plan, {
    actorType: "human",
    actorId: parsedInput.data.reviewerId,
    reason: "Approved deterministic action from human review",
    reviewCaseId,
    reviewerNote: parsedInput.data.note,
  });
}
