/**
 * SettleGuard — Phase 4, Step 1: wires the whole vertical slice
 * together — load exception -> agent investigates -> policy decides
 * -> evidence page displays the result.
 *
 * The policy step here is deliberately minimal, NOT Phase 5's real
 * resolution policy engine (confidence/amount/reversibility
 * thresholds, auto-resolve gating). That's its own dedicated phase
 * on Day 9. Today's stub does exactly one thing: if the agent's
 * structured output says requiresHumanApproval (or the agent
 * produced an AI_ERROR), open a review case. Enough to complete the
 * loop end to end without pre-building Phase 5 two days early.
 */

import { eq } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { db } from "../db/client.js";
import { agentEvents, exceptions, investigations, reviewCases } from "../db/schema.js";
import { toolDefinitions, executeTool } from "./tools.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { runAgentLoopWithValidation, type ModelCaller } from "./loop.js";
import { renderEvidencePage } from "./evidence-html.js";

const AGENT_MODEL = process.env.SETTLEGUARD_AGENT_MODEL ?? "claude-sonnet-5";
const PROMPT_VERSION = "day6-v1";

export interface InvestigationSummary {
  investigationId: number;
  outcomeStatus: "completed" | "ai_error";
  policyDecision: string;
  evidencePagePath: string;
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

  const { outcome, steps } = await runAgentLoopWithValidation(SYSTEM_PROMPT, initialMessage, toolDefinitions, callModel, executeTool);

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

  // Minimal policy stub — see file header.
  let policyDecision: string;
  if (outcome.status === "ai_error") {
    policyDecision = `AI_ERROR — no structured result was produced (${outcome.reason}). Opened a review case for manual investigation.`;
    await db.insert(reviewCases).values({ exceptionId, status: "pending", proposedAction: "manual_investigation_required" });
  } else if (outcome.result.requiresHumanApproval) {
    const [caseRow] = await db.insert(reviewCases).values({ exceptionId, status: "pending", proposedAction: outcome.result.recommendedAction }).returning();
    policyDecision = `Review case #${caseRow!.id} created — requires human approval (agent recommended "${outcome.result.recommendedAction}" at ${(outcome.result.confidence * 100).toFixed(0)}% confidence).`;
  } else {
    policyDecision = `No review case created — agent recommended "${outcome.result.recommendedAction}" and did not flag it for human approval. (Note: Day 6's stub does not yet enforce Phase 5's auto-resolve gates; treat this path as informational only until Phase 5 exists.)`;
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

  return { investigationId, outcomeStatus: outcome.status, policyDecision, evidencePagePath: outputHtmlPath };
}
