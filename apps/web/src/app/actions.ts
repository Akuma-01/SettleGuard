"use server";

import { redirect } from "next/navigation";
import { postApiData } from "@/lib/api";

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
