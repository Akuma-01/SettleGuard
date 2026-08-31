/**
 * Controlled workflow actions.
 *
 * These definitions are intentionally NOT included in the model's normal
 * tool catalog. A trusted application layer must pass authorization out of
 * band after policy evaluation; model-supplied JSON can never grant it.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { auditLogs, exceptions, reviewCases } from "../db/schema.js";
import type { ToolDefinition } from "./tools.js";

export type ControlledActionName = "create_review_case" | "propose_adjustment";

export interface ActionAuthorization {
  actorType: "human" | "system";
  actorId: string;
  allowedActions: ReadonlySet<ControlledActionName>;
  reason: string;
}

export const controlledActionDefinitions: ToolDefinition[] = [
  {
    name: "create_review_case",
    description: "Create a pending human-review case for an exception. Requires trusted application authorization outside tool input.",
    input_schema: {
      type: "object",
      properties: {
        exceptionId: { type: "integer", description: "Internal exceptions.id" },
        proposedAction: { type: "string", description: "Short action the reviewer should evaluate" },
      },
      required: ["exceptionId", "proposedAction"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_adjustment",
    description: "Create a human-review case containing a proposed accounting adjustment. It never changes a source financial record.",
    input_schema: {
      type: "object",
      properties: {
        exceptionId: { type: "integer", description: "Internal exceptions.id" },
        amountPaise: { type: "integer", description: "Signed proposed adjustment amount in paise" },
        reason: { type: "string", description: "Evidence-backed reason for the proposal" },
      },
      required: ["exceptionId", "amountPaise", "reason"],
      additionalProperties: false,
    },
  },
];

const reviewInput = z.object({
  exceptionId: z.number().int().positive(),
  proposedAction: z.string().trim().min(1).max(500),
}).strict();

const adjustmentInput = z.object({
  exceptionId: z.number().int().positive(),
  amountPaise: z.number().int().refine((amount) => amount !== 0, "amountPaise must not be zero"),
  reason: z.string().trim().min(1).max(1_000),
}).strict();

function invalidInput(error: z.ZodError) {
  return { error: "Invalid tool input", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
}

async function ensureException(exceptionId: number) {
  const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, exceptionId));
  return exception ?? null;
}

async function createReviewCase(
  input: z.infer<typeof reviewInput>,
  authorization: ActionAuthorization,
) {
  if (!(await ensureException(input.exceptionId))) return { error: `No exception with id ${input.exceptionId}` };

  const [existing] = await db.select().from(reviewCases).where(and(
    eq(reviewCases.exceptionId, input.exceptionId),
    eq(reviewCases.status, "pending"),
    eq(reviewCases.proposedAction, input.proposedAction),
  ));
  if (existing) return { reviewCase: existing, created: false };

  return db.transaction(async (tx) => {
    const [reviewCase] = await tx.insert(reviewCases).values({
      exceptionId: input.exceptionId,
      status: "pending",
      proposedAction: input.proposedAction,
    }).returning();
    await tx.insert(auditLogs).values({
      actorType: authorization.actorType,
      actorId: authorization.actorId,
      action: "create_review_case",
      entityType: "review_case",
      entityId: reviewCase!.id,
      afterJson: reviewCase,
      metadataJson: { authorizationReason: authorization.reason, exceptionId: input.exceptionId },
    });
    return { reviewCase, created: true };
  });
}

async function proposeAdjustment(
  input: z.infer<typeof adjustmentInput>,
  authorization: ActionAuthorization,
) {
  const proposedAction = JSON.stringify({ type: "propose_adjustment", amountPaise: input.amountPaise, reason: input.reason });
  return createReviewCase({ exceptionId: input.exceptionId, proposedAction }, authorization);
}

export async function executeControlledAction(
  name: ControlledActionName,
  input: Record<string, unknown>,
  authorization?: ActionAuthorization,
): Promise<unknown> {
  if (!authorization || !authorization.allowedActions.has(name)) {
    return { error: "Action denied: trusted policy authorization is required", action: name };
  }
  if (!authorization.actorId.trim() || !authorization.reason.trim()) {
    return { error: "Action denied: authorization must identify an actor and reason", action: name };
  }
  if (name === "create_review_case") {
    const parsed = reviewInput.safeParse(input);
    return parsed.success ? createReviewCase(parsed.data, authorization) : invalidInput(parsed.error);
  }
  const parsed = adjustmentInput.safeParse(input);
  return parsed.success ? proposeAdjustment(parsed.data, authorization) : invalidInput(parsed.error);
}
