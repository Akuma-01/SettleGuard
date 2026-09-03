import { and, count, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { adjustments, bankTransactions, batches, merchants, payments, reconciliationRuns, refunds, settlements } from "../../db/schema.js";
import { runReconciliation } from "../../reconciliation/run.js";
import { ingestDataset } from "../../ingestion/ingest-batch.js";
import type { ApiErrorBody } from "../app.js";
import type { AppDependencies } from "../app.js";
import { parsePositiveId } from "../params.js";

async function tableCount(table: typeof payments | typeof refunds | typeof settlements | typeof bankTransactions | typeof adjustments, batchId: number) {
  const [row] = await db.select({ value: count() }).from(table).where(eq(table.batchId, batchId));
  return row!.value;
}

const demoRequestSchema = z.object({
  batchName: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/).optional(),
}).strict().default({});

export async function registerBatchRoutes(app: FastifyInstance, dependencies: AppDependencies): Promise<void> {
  app.post<{ Body: unknown }>("/api/batches/demo", async (request, reply) => {
    const input = demoRequestSchema.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send({
        error: { code: "INVALID_DEMO_BATCH", message: "batchName must be 3-80 characters using letters, numbers, dots, underscores, or hyphens" },
      } satisfies ApiErrorBody);
    }
    const batchName = input.data.batchName ?? `demo-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      const ingestion = await ingestDataset(dependencies.demoDatasetDirectory, batchName);
      return reply.code(201).send({ ingestion });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Batch \"") && message.includes("already exists")) {
        return reply.code(409).send({ error: { code: "BATCH_ALREADY_EXISTS", message } } satisfies ApiErrorBody);
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/api/batches/:id/reconcile", async (request, reply) => {
    const batchId = parsePositiveId(request.params.id);
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
    const batchId = parsePositiveId(request.params.id);
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
