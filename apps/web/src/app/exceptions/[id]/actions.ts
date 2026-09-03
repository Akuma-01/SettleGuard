"use server";

import { redirect } from "next/navigation";
import { postApi } from "@/lib/api";

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function finish(exceptionId: number, result: { ok: boolean; message: string }) {
  const key = result.ok ? "notice" : "error";
  redirect(`/exceptions/${exceptionId}?${key}=${encodeURIComponent(result.message)}`);
}

export async function investigateAction(exceptionId: number) {
  finish(exceptionId, await postApi(`/api/exceptions/${exceptionId}/investigate`));
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
