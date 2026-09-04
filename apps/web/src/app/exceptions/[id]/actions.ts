"use server";

import { redirect } from "next/navigation";
import { postApi, postApiData } from "@/lib/api";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function finish(exceptionId: number, result: { ok: boolean; message: string }): never {
  const key = result.ok ? "notice" : "error";
  redirect(`/exceptions/${exceptionId}?${key}=${encodeURIComponent(result.message)}`);
}

export async function investigateAction(exceptionId: number) {
  type InvestigationResponse = {
    investigation: {
      outcomeStatus: "completed" | "ai_error";
      policyDecision: string;
      outcome: { status: "completed" } | { status: "ai_error"; reason: string };
    };
  };
  const response = await postApiData<InvestigationResponse>(
    `/api/exceptions/${exceptionId}/investigate`,
    undefined,
    { timeoutMs: 10 * 60_000 },
  );
  if (!response.data) finish(exceptionId, { ok: false, message: response.message });
  const summary = response.data.investigation;
  if (summary.outcomeStatus === "completed") {
    finish(exceptionId, { ok: true, message: "AI investigation completed and passed to deterministic policy controls." });
  }
  const reason = summary.outcome.status === "ai_error" ? summary.outcome.reason : "";
  const providerState = /429|quota|rate limit/i.test(reason)
    ? "The AI provider quota is temporarily exhausted."
    : /500|502|503|504|high demand|unavailable/i.test(reason)
      ? "The AI provider is temporarily unavailable."
      : /timed? out|timeout/i.test(reason)
        ? "The AI provider timed out."
        : "The AI provider could not return a validated conclusion.";
  finish(exceptionId, {
    ok: true,
    message: `${providerState} Deterministic evidence was preserved and the exception was routed to human review.`,
  });
}

export async function reviewAction(exceptionId: number, reviewCaseId: number, formData: FormData) {
  const reviewerId = value(formData, "reviewerId");
  const note = value(formData, "note");
  const decision = value(formData, "decision");
  if (!reviewerId || !note || !["approve", "reject", "mark_unresolved"].includes(decision)) {
    redirect(`/exceptions/${exceptionId}?error=${encodeURIComponent("Reviewer, note, and a valid decision are required.")}`);
  }
  const path = decision === "approve" ? "approve" : "reject";
  const body = decision === "approve" ? { reviewerId, note } : { reviewerId, note, decision };
  finish(exceptionId, await postApi(`/api/review-cases/${reviewCaseId}/${path}`, body));
}
