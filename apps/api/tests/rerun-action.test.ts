import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { auditLogs, batches, exceptions, merchants, reconciliationRuns } from "../src/db/schema.js";
import { executeRerunAction } from "../src/policy/rerun-action.js";

let exceptionId: number;
let originalRunId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "Rerun Action Test" }).returning();

  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `rerun-action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
    recordCount: 0,
  }).returning();
  const [run] = await db.insert(reconciliationRuns).values({
    batchId: batch!.id,
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
  }).returning();
  originalRunId = run!.id;

  const [exception] = await db.insert(exceptions).values({
    runId: originalRunId,
    type: "FEE_MISMATCH",
    severity: "medium",
    status: "OPEN",
    amountAtRiskPaise: 500,
    primaryRecordType: "settlement",
    primaryRecordId: 999_999,
    summary: "Synthetic cleared-on-rerun exception",
    deterministicEvidenceJson: {},
  }).returning();
  exceptionId = exception!.id;
});

describe("executeRerunAction", () => {
  it("reruns the original batch and auto-resolves only after the exception is absent", async () => {
    const result = await executeRerunAction({
      action: "rerun_reconciliation",
      exceptionId,
      reconciliationRunId: originalRunId,
    });

    expect(result).toMatchObject({
      status: "executed",
      exceptionId,
      assessment: { outcome: "cleared" },
      resolved: true,
    });
    if (result.status !== "executed") throw new Error("Expected executed rerun");
    expect(result.rerun.runId).not.toBe(originalRunId);

    const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, exceptionId));
    expect(exception).toMatchObject({ status: "AUTO_RESOLVED" });
    expect(exception!.resolvedAt).toBeInstanceOf(Date);

    const [originalRun] = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, originalRunId));
    expect(originalRun!.autoResolvedCount).toBe(1);

    const [audit] = await db.select().from(auditLogs).where(and(
      eq(auditLogs.entityType, "exception"),
      eq(auditLogs.entityId, exceptionId),
      eq(auditLogs.action, "rerun_reconciliation"),
    ));
    expect(audit).toBeDefined();
    expect(audit!.afterJson).toMatchObject({ status: "AUTO_RESOLVED", assessment: { outcome: "cleared" } });
    expect(audit!.metadataJson).toMatchObject({ originalRunId, rerunSummary: { runId: result.rerun.runId } });
  });

  it("turns retries into no-ops after resolution", async () => {
    const runsBefore = await db.select().from(reconciliationRuns);
    const result = await executeRerunAction({
      action: "rerun_reconciliation",
      exceptionId,
      reconciliationRunId: originalRunId,
    });
    const runsAfter = await db.select().from(reconciliationRuns);

    expect(result).toEqual({ status: "already_resolved", exceptionId });
    expect(runsAfter).toHaveLength(runsBefore.length);
  });

  it("rejects a plan scoped to the wrong reconciliation run", async () => {
    await expect(executeRerunAction({
      action: "rerun_reconciliation",
      exceptionId,
      reconciliationRunId: originalRunId + 1,
    })).rejects.toThrow(/does not belong/);
  });
});
