/** Execute a reversible reconciliation rerun and close only proven-cleared exceptions. */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditLogs, exceptions, reconciliationRuns } from "../db/schema.js";
import { runReconciliation, type ReconciliationSummary } from "../reconciliation/run.js";
import type { ExecutableActionPlan } from "./action-plan.js";
import { assessRerun, type RerunAssessment } from "./rerun-assessment.js";

type RerunPlan = Extract<ExecutableActionPlan, { action: "rerun_reconciliation" }>;

export type RerunActionResult =
  | { status: "already_resolved"; exceptionId: number }
  | {
      status: "executed";
      exceptionId: number;
      rerun: ReconciliationSummary;
      assessment: RerunAssessment;
      resolved: boolean;
    };

export async function executeRerunAction(plan: RerunPlan): Promise<RerunActionResult> {
  const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, plan.exceptionId));
  if (!exception) throw new Error(`No exception with id ${plan.exceptionId}`);
  if (exception.runId !== plan.reconciliationRunId) {
    throw new Error(`Exception ${plan.exceptionId} does not belong to reconciliation run ${plan.reconciliationRunId}`);
  }
  if (exception.status !== "OPEN" || exception.resolvedAt !== null) {
    return { status: "already_resolved", exceptionId: exception.id };
  }

  const [originalRun] = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, plan.reconciliationRunId));
  if (!originalRun) throw new Error(`No reconciliation run with id ${plan.reconciliationRunId}`);

  const rerun = await runReconciliation(originalRun.batchId);
  const rerunExceptions = await db.select().from(exceptions).where(eq(exceptions.runId, rerun.runId));
  const assessment = assessRerun(exception, rerun.runId, rerunExceptions);
  const resolved = assessment.outcome === "cleared";

  await db.transaction(async (tx) => {
    if (resolved) {
      const updated = await tx
        .update(exceptions)
        .set({ status: "AUTO_RESOLVED", resolvedAt: new Date() })
        .where(and(eq(exceptions.id, exception.id), eq(exceptions.status, "OPEN")))
        .returning({ id: exceptions.id });
      if (updated.length !== 1) throw new Error(`Exception ${exception.id} changed while rerun resolution was executing`);

      await tx
        .update(reconciliationRuns)
        .set({ autoResolvedCount: sql<number>`coalesce(${reconciliationRuns.autoResolvedCount}, 0) + 1` })
        .where(eq(reconciliationRuns.id, originalRun.id));
    }

    await tx.insert(auditLogs).values({
      actorType: "system",
      actorId: "resolution-action-executor",
      action: "rerun_reconciliation",
      entityType: "exception",
      entityId: exception.id,
      beforeJson: { status: exception.status, resolvedAt: exception.resolvedAt },
      afterJson: { status: resolved ? "AUTO_RESOLVED" : exception.status, assessment },
      metadataJson: { plan, originalRunId: originalRun.id, rerunSummary: rerun },
    });
  });

  return { status: "executed", exceptionId: exception.id, rerun, assessment, resolved };
}
