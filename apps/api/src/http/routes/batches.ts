import { and, count, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { adjustments, bankTransactions, batches, merchants, payments, reconciliationRuns, refunds, settlements } from "../../db/schema.js";
import { runReconciliation } from "../../reconciliation/run.js";
import type { ApiErrorBody } from "../app.js";

function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function tableCount(table: typeof payments | typeof refunds | typeof settlements | typeof bankTransactions | typeof adjustments, batchId: number) {
  const [row] = await db.select({ value: count() }).from(table).where(eq(table.batchId, batchId));
  return row!.value;
}

export async function registerBatchRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/api/batches/:id/reconcile", async (request, reply) => {
    const batchId = parseId(request.params.id);
    if (batchId === null) {
      return reply.code(400).send({ error: { code: "INVALID_BATCH_ID", message: "Batch id must be a positive integer" } } satisfies ApiErrorBody);
    }
    const [batch] = await db.select({ id: batches.id }).from(batches).where(eq(batches.id, batchId));
    if (!batch) {
      return reply.code(404).send({ error: { code: "BATCH_NOT_FOUND", message: `No batch with id ${batchId}` } } satisfies ApiErrorBody);
    }
    const [processing] = await db.select({ id: reconciliationRuns.id }).from(reconciliationRuns).where(and(
      eq(reconciliationRuns.batchId, batchId),
      eq(reconciliationRuns.status, "processing"),
    ));
    if (processing) {
      return reply.code(409).send({
        error: { code: "RECONCILIATION_IN_PROGRESS", message: `Reconciliation run ${processing.id} is already processing this batch` },
      } satisfies ApiErrorBody);
    }

    const summary = await runReconciliation(batchId);
    return reply.code(201).send({ run: summary });
  });

  app.get<{ Params: { id: string } }>("/api/batches/:id", async (request, reply) => {
    const batchId = parseId(request.params.id);
    if (batchId === null) {
      return reply.code(400).send({ error: { code: "INVALID_BATCH_ID", message: "Batch id must be a positive integer" } } satisfies ApiErrorBody);
    }

    const [batch] = await db.select({
      id: batches.id,
      merchantId: batches.merchantId,
      merchantName: merchants.name,
      name: batches.name,
      status: batches.status,
      startedAt: batches.startedAt,
      completedAt: batches.completedAt,
      recordCount: batches.recordCount,
    }).from(batches).innerJoin(merchants, eq(batches.merchantId, merchants.id)).where(eq(batches.id, batchId));
    if (!batch) {
      return reply.code(404).send({ error: { code: "BATCH_NOT_FOUND", message: `No batch with id ${batchId}` } } satisfies ApiErrorBody);
    }

    const [paymentCount, refundCount, settlementCount, bankTransactionCount, adjustmentCount, runs] = await Promise.all([
      tableCount(payments, batchId),
      tableCount(refunds, batchId),
      tableCount(settlements, batchId),
      tableCount(bankTransactions, batchId),
      tableCount(adjustments, batchId),
      db.select().from(reconciliationRuns).where(eq(reconciliationRuns.batchId, batchId)).orderBy(desc(reconciliationRuns.id)),
    ]);

    return {
      batch,
      sourceCounts: {
        payments: paymentCount,
        refunds: refundCount,
        settlements: settlementCount,
        bankTransactions: bankTransactionCount,
        adjustments: adjustmentCount,
        total: paymentCount + refundCount + settlementCount + bankTransactionCount + adjustmentCount,
      },
      reconciliationRuns: runs,
    };
  });
}
