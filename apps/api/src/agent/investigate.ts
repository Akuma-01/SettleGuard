/** Load exception -> investigate -> apply deterministic policy -> render evidence. */

import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { db } from "../db/client.js";
import { agentEvents, exceptions, investigations } from "../db/schema.js";
import { decideResolution, type ResolutionDecisionBundle } from "../policy/decide-resolution.js";
import { executeControlledAction } from "./controlled-actions.js";
import { toolDefinitions, executeTool } from "./tools.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { runAgentLoopWithValidation, type ModelCaller } from "./loop.js";
import { renderEvidencePage } from "./evidence-html.js";
import type { InvestigationOutcome } from "./schema.js";

export const AGENT_MODEL = process.env.SETTLEGUARD_AGENT_MODEL ?? "claude-sonnet-5";
export const PROMPT_VERSION = "day7-v2";

export interface InvestigationSummary {
  investigationId: number;
  outcomeStatus: "completed" | "ai_error";
  policyDecision: string;
  evidencePagePath: string;
  outcome: InvestigationOutcome;
  resolutionDecision: ResolutionDecisionBundle;
}

interface ReviewCaseActionResult {
  reviewCase: { id: number };
  created: boolean;
}

function isReviewCaseActionResult(value: unknown): value is ReviewCaseActionResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReviewCaseActionResult>;
  return typeof candidate.created === "boolean"
    && !!candidate.reviewCase
    && typeof candidate.reviewCase.id === "number";
}

async function openPolicyReviewCase(exceptionId: number, proposedAction: string, reasons: string[]): Promise<ReviewCaseActionResult> {
  const result = await executeControlledAction(
    "create_review_case",
    { exceptionId, proposedAction },
    {
      actorType: "system",
      actorId: "resolution-policy",
      allowedActions: new Set(["create_review_case"]),
      reason: `Policy decision requires review: ${reasons.join(", ")}`,
    },
  );
  if (!isReviewCaseActionResult(result)) throw new Error(`Failed to create policy review case for exception ${exceptionId}`);
  return result;
}

export async function investigateException(exceptionId: number, callModel: ModelCaller, outputHtmlPath: string): Promise<InvestigationSummary> {
  const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, exceptionId));
  if (!exception) throw new Error(`No exception with id ${exceptionId}`);

  const [investigationRow] = await db
    .insert(investigations)
    .values({ exceptionId, status: "in_progress", model: AGENT_MODEL, promptVersion: PROMPT_VERSION, startedAt: new Date() })
    .returning();
  const investigationId = investigationRow!.id;

  const initialMessage = `Investigate exception #${exception.id}.
Type: ${exception.type}
Severity: ${exception.severity}
Amount at risk: ${exception.amountAtRiskPaise} paise
Primary record: ${exception.primaryRecordType} #${exception.primaryRecordId}
Summary: ${exception.summary}
Deterministic evidence already gathered: ${JSON.stringify(exception.deterministicEvidenceJson)}

Use the available tools to gather whatever further context you need, then respond with the required structured JSON.`;

  const trustedEvidenceRecordIds = [
    `exception:${exception.id}`,
    ...(exception.primaryRecordType && exception.primaryRecordId ? [`${exception.primaryRecordType}:${exception.primaryRecordId}`] : []),
  ];
  const { outcome, steps } = await runAgentLoopWithValidation(
    SYSTEM_PROMPT,
    initialMessage,
    toolDefinitions,
    callModel,
    executeTool,
    { expectedExceptionId: exceptionId, trustedEvidenceRecordIds },
  );

  // Persist the trace, in order.
  const eventRows = steps.map((step, i) => ({
    investigationId,
    sequenceNumber: i + 1,
    eventType: step.type,
    toolName: step.type !== "final_text" ? step.toolName : null,
    toolInputJson: step.type === "tool_call" ? step.toolInput : null,
    toolOutputJson: step.type === "tool_result" ? step.toolOutput : null,
  }));
  if (eventRows.length > 0) await db.insert(agentEvents).values(eventRows);

  const resolutionDecision = decideResolution({ exception, outcome });
  const { policy } = resolutionDecision;
  let policyDecision: string;
  if (policy.decision === "auto_resolve") {
    policyDecision = `Eligible for auto-resolution (${policy.reasons.join(", ")}). No action was executed because the controlled action executor is not connected yet.`;
  } else {
    const proposedAction = policy.recommendedAction ?? "manual_investigation_required";
    const review = await openPolicyReviewCase(exceptionId, proposedAction, policy.reasons);
    const disposition = policy.decision === "unresolved" ? "Unresolved" : "Human review required";
    policyDecision = `${disposition} (${policy.reasons.join(", ")}). Review case #${review.reviewCase.id} ${review.created ? "created" : "reused"}.`;
  }

  await db
    .update(investigations)
    .set({
      status: outcome.status === "completed" ? "completed" : "failed",
      rootCause: outcome.status === "completed" ? outcome.result.rootCause : null,
      confidence: outcome.status === "completed" ? outcome.result.confidence : null,
      recommendedAction: outcome.status === "completed" ? outcome.result.recommendedAction : null,
      requiresHumanApproval: outcome.status === "completed" ? outcome.result.requiresHumanApproval : true,
      structuredOutputJson: outcome.status === "completed" ? outcome.result : { error: outcome.reason },
      completedAt: new Date(),
    })
    .where(eq(investigations.id, investigationId));

  const html = renderEvidencePage({ exception, steps, outcome, policyDecision });
  writeFileSync(outputHtmlPath, html, "utf-8");

  return { investigationId, outcomeStatus: outcome.status, policyDecision, evidencePagePath: outputHtmlPath, outcome, resolutionDecision };
}
