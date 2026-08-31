/**
 * SettleGuard — Phase 4, Step 1: "some UI (even a plain page) displays
 * the evidence." Literally that — one static HTML file, no framework,
 * no build step, no server (Phase 6 doesn't exist yet). Phase 7 is
 * where the real control-room frontend belongs; this is deliberately
 * not a preview of that, just enough to look at today's result in a
 * browser instead of a terminal.
 */

import type { AgentStep } from "./loop.js";
import type { InvestigationOutcome } from "./schema.js";
import type { ExceptionRecord } from "../db/schema.js";

function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inr(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? "-" : "";
  return `${sign}\u20B9${Math.abs(rupees).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderStep(step: AgentStep, i: number): string {
  if (step.type === "tool_call") {
    return `<div class="step step-call"><span class="step-num">${i}</span> <strong>Called</strong> <code>${esc(step.toolName)}(${esc(JSON.stringify(step.toolInput))})</code></div>`;
  }
  if (step.type === "tool_result") {
    const preview = JSON.stringify(step.toolOutput, null, 2);
    return `<div class="step step-result"><span class="step-num">${i}</span> <strong>Result</strong><pre>${esc(preview)}</pre></div>`;
  }
  return `<div class="step step-final"><span class="step-num">${i}</span> <strong>Final response</strong><pre>${esc(step.text)}</pre></div>`;
}

export interface EvidencePageData {
  exception: ExceptionRecord;
  steps: AgentStep[];
  outcome: InvestigationOutcome;
  policyDecision: string; // e.g. "Review case #12 created — requires human approval."
}

export function renderEvidencePage(data: EvidencePageData): string {
  const { exception, steps, outcome, policyDecision } = data;

  const resultHtml =
    outcome.status === "completed"
      ? `
      <div class="card result-ok">
        <h2>Investigation result</h2>
        <dl>
          <dt>Root cause</dt><dd>${esc(outcome.result.rootCause)}</dd>
          <dt>Confidence</dt><dd>${(outcome.result.confidence * 100).toFixed(0)}%</dd>
          <dt>Recommended action</dt><dd><span class="badge badge-${esc(outcome.result.recommendedAction)}">${esc(outcome.result.recommendedAction)}</span></dd>
          <dt>Requires human approval</dt><dd>${outcome.result.requiresHumanApproval ? "Yes" : "No"}</dd>
          <dt>Evidence cited</dt><dd><ul>${outcome.result.evidence.map((e) => `<li><code>${esc(e.recordId)}</code> — ${esc(e.reason)}</li>`).join("")}</ul></dd>
          <dt>Explanation</dt><dd>${esc(outcome.result.explanation)}</dd>
        </dl>
      </div>`
      : `
      <div class="card result-error">
        <h2>AI_ERROR — no result produced</h2>
        <p>${esc(outcome.reason)}</p>
        ${outcome.rawResponse ? `<pre>${esc(outcome.rawResponse)}</pre>` : ""}
        <p class="note">The agent could not produce a validated result, so none is shown here. An AI_ERROR is reported explicitly, never silently replaced with a guess.</p>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SettleGuard — Investigation of Exception #${exception.id}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 0; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; margin: 16px 0; }
  .result-ok { border-color: #2e7d32; background: #f1f8f2; }
  .result-error { border-color: #c62828; background: #fdf1f1; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; background: #eee; font-size: 0.85em; }
  .badge-create_review_case, .badge-propose_adjustment { background: #fff3cd; }
  .badge-no_action { background: #f8d7da; }
  .badge-link_record, .badge-reclassify, .badge-rerun_reconciliation { background: #d4edda; }
  dt { font-weight: 600; margin-top: 10px; }
  dd { margin-left: 0; }
  .step { border-left: 3px solid #ccc; padding: 6px 12px; margin: 8px 0; font-size: 0.92em; }
  .step-num { color: #999; margin-right: 6px; }
  .step-call { border-color: #1565c0; }
  .step-result { border-color: #6a1b9a; }
  .step-final { border-color: #2e7d32; }
  code, pre { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; overflow-x: auto; }
  pre { padding: 10px; white-space: pre-wrap; word-break: break-word; }
  .policy { background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 14px 18px; }
  .amount { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
  <h1>SettleGuard — Investigation of Exception #${exception.id}</h1>
  <div class="card">
    <h2>Exception</h2>
    <dl>
      <dt>Type</dt><dd>${esc(exception.type)}</dd>
      <dt>Severity</dt><dd>${esc(exception.severity)}</dd>
      <dt>Amount at risk</dt><dd class="amount">${inr(exception.amountAtRiskPaise)}</dd>
      <dt>Summary</dt><dd>${esc(exception.summary)}</dd>
    </dl>
  </div>

  <h2>Agent investigation trace</h2>
  ${steps.map((s, i) => renderStep(s, i + 1)).join("\n")}

  ${resultHtml}

  <div class="policy">
    <strong>Policy decision:</strong> ${esc(policyDecision)}
  </div>
</body>
</html>`;
}
