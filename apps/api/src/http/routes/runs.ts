import { count, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { db } from "../../db/client.js";
import { batches, exceptions, matches, merchants, reconciliationRuns } from "../../db/schema.js";
import type { ApiErrorBody } from "../app.js";
import { parsePositiveId } from "../params.js";

async function loadRun(runId: number) {
  const [run] = await db.select({
    id: reconciliationRuns.id,
    batchId: reconciliationRuns.batchId,
    batchName: batches.name,
    merchantId: batches.merchantId,
    merchantName: merchants.name,
    status: reconciliationRuns.status,
    startedAt: reconciliationRuns.startedAt,
    completedAt: reconciliationRuns.completedAt,
    totalRecords: reconciliationRuns.totalRecords,
    matchedRecords: reconciliationRuns.matchedRecords,
    unmatchedRecords: reconciliationRuns.unmatchedRecords,
    matchRate: reconciliationRuns.matchRate,
    exceptionCount: reconciliationRuns.exceptionCount,
    autoResolvedCount: reconciliationRuns.autoResolvedCount,
    humanReviewCount: reconciliationRuns.humanReviewCount,
    unresolvedCount: reconciliationRuns.unresolvedCount,
  }).from(reconciliationRuns)
    .innerJoin(batches, eq(reconciliationRuns.batchId, batches.id))
    .innerJoin(merchants, eq(batches.merchantId, merchants.id))
    .where(eq(reconciliationRuns.id, runId));
  return run ?? null;
}

function invalidRunId(reply: FastifyReply) {
  return reply.code(400).send({ error: { code: "INVALID_RUN_ID", message: "Run id must be a positive integer" } } satisfies ApiErrorBody);
}

function runNotFound(reply: FastifyReply, runId: number) {
  return reply.code(404).send({ error: { code: "RUN_NOT_FOUND", message: `No reconciliation run with id ${runId}` } } satisfies ApiErrorBody);
}

export async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const runId = parsePositiveId(request.params.id);
    if (runId === null) return invalidRunId(reply);
    const run = await loadRun(runId);
    if (!run) return runNotFound(reply, runId);

    const [exceptionRows, matchCountRow] = await Promise.all([
      db.select().from(exceptions).where(eq(exceptions.runId, runId)),
      db.select({ value: count() }).from(matches).where(eq(matches.runId, runId)),
    ]);
    const exceptionsByType: Record<string, number> = {};
    for (const exception of exceptionRows) exceptionsByType[exception.type] = (exceptionsByType[exception.type] ?? 0) + 1;

    return {
      run,
      matchCount: matchCountRow[0]!.value,
      exceptionsByType,
    };
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id/metrics", async (request, reply) => {
    const runId = parsePositiveId(request.params.id);
    if (runId === null) return invalidRunId(reply);
    const run = await loadRun(runId);
    if (!run) return runNotFound(reply, runId);

    const exceptionRows = await db.select({
      status: exceptions.status,
      amountAtRiskPaise: exceptions.amountAtRiskPaise,
    }).from(exceptions).where(eq(exceptions.runId, runId));
    const exceptionStatusCounts: Record<string, number> = {};
    let amountAtRiskPaise = 0;
    for (const exception of exceptionRows) {
      exceptionStatusCounts[exception.status] = (exceptionStatusCounts[exception.status] ?? 0) + 1;
      if (exception.status === "OPEN" || exception.status === "UNRESOLVED") amountAtRiskPaise += exception.amountAtRiskPaise;
    }

    return {
      runId,
      status: run.status,
      records: {
        total: run.totalRecords ?? 0,
        matched: run.matchedRecords ?? 0,
        unmatched: run.unmatchedRecords ?? 0,
        matchRate: run.matchRate ?? 0,
      },
      exceptions: {
        total: exceptionRows.length,
        byStatus: exceptionStatusCounts,
        amountAtRiskPaise,
      },
      resolutions: {
        autoResolved: run.autoResolvedCount ?? 0,
        humanReview: run.humanReviewCount ?? 0,
        unresolved: run.unresolvedCount ?? 0,
      },
    };
  });
}
