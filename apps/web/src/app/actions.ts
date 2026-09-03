"use server";

import { redirect } from "next/navigation";
import { postApiData, postMultipartData } from "@/lib/api";

interface DemoResponse { ingestion: { batchId: number } }
interface ReconcileResponse { run: { runId: number } }

export async function runDemoAction() {
  const batchName = `demo-ui-${Date.now()}`;
  const created = await postApiData<DemoResponse>("/api/batches/demo", { batchName });
  if (!created.data) redirect(`/?error=${encodeURIComponent(created.message)}`);

  const reconciled = await postApiData<ReconcileResponse>(`/api/batches/${created.data.ingestion.batchId}/reconcile`);
  if (!reconciled.data) redirect(`/?error=${encodeURIComponent(reconciled.message)}`);
  redirect(`/?runId=${reconciled.data.run.runId}&notice=${encodeURIComponent("Demo batch loaded and reconciled.")}`);
}

export async function uploadDatasetAction(formData: FormData) {
  const batchName = formData.get("batchName");
  const files = formData.getAll("files");
  const requiredNames = new Set(["payments.csv", "refunds.csv", "settlements.csv", "bank_transactions.csv", "adjustments.csv"]);
  const validName = typeof batchName === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(batchName.trim());
  const validFiles = files.length === 5 && files.every((file) => file instanceof File && requiredNames.delete(file.name) && file.size <= 5 * 1024 * 1024);
  if (!validName || !validFiles || requiredNames.size > 0) {
    redirect(`/?error=${encodeURIComponent("Provide a valid batch name and each of the five required CSV files (5 MB maximum each).")}`);
  }

  const created = await postMultipartData<DemoResponse>("/api/batches/upload", formData);
  if (!created.data) redirect(`/?error=${encodeURIComponent(created.message)}`);
  const reconciled = await postApiData<ReconcileResponse>(`/api/batches/${created.data.ingestion.batchId}/reconcile`);
  if (!reconciled.data) redirect(`/?error=${encodeURIComponent(reconciled.message)}`);
  redirect(`/?runId=${reconciled.data.run.runId}&notice=${encodeURIComponent("Dataset uploaded and reconciled.")}`);
}
