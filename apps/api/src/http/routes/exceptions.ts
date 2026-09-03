import { and, asc, count, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { agentEvents, auditLogs, batches, exceptions, investigations, merchants, reconciliationRuns, reviewCases } from "../../db/schema.js";
import type { ApiErrorBody } from "../app.js";
import { parsePositiveId } from "../params.js";

const exceptionStatuses = new Set(["OPEN", "AUTO_RESOLVED", "HUMAN_RESOLVED", "UNRESOLVED"]);
const exceptionTypes = new Set(["MISSING_SETTLEMENT", "FEE_MISMATCH", "UNKNOWN_ADJUSTMENT", "DUPLICATE_REFUND", "BANK_CREDIT_MISMATCH", "AMBIGUOUS_MATCH"]);

interface ExceptionListQuery {
  runId?: string;
  status?: string;
  type?: string;
  limit?: string;
  offset?: string;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function registerExceptionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/exceptions/:id", async (request, reply) => {
    const exceptionId = parsePositiveId(request.params.id);
    if (exceptionId === null) {
      return reply.code(400).send({ error: { code: "INVALID_EXCEPTION_ID", message: "Exception id must be a positive integer" } } satisfies ApiErrorBody);
    }

    const [context] = await db.select({
      exception: exceptions,
      run: {
        id: reconciliationRuns.id,
        status: reconciliationRuns.status,
        batchId: reconciliationRuns.batchId,
      },
      batch: {
        id: batches.id,
        name: batches.name,
        merchantId: batches.merchantId,
        merchantName: merchants.name,
      },
    }).from(exceptions)
      .innerJoin(reconciliationRuns, eq(exceptions.runId, reconciliationRuns.id))
      .innerJoin(batches, eq(reconciliationRuns.batchId, batches.id))
      .innerJoin(merchants, eq(batches.merchantId, merchants.id))
      .where(eq(exceptions.id, exceptionId));
    if (!context) {
      return reply.code(404).send({ error: { code: "EXCEPTION_NOT_FOUND", message: `No exception with id ${exceptionId}` } } satisfies ApiErrorBody);
    }

    const [investigationRows, reviews] = await Promise.all([
      db.select().from(investigations).where(eq(investigations.exceptionId, exceptionId)).orderBy(desc(investigations.id)),
      db.select().from(reviewCases).where(eq(reviewCases.exceptionId, exceptionId)).orderBy(desc(reviewCases.id)),
    ]);
    const investigationIds = investigationRows.map((row) => row.id);
    const events = investigationIds.length > 0
      ? await db.select().from(agentEvents).where(inArray(agentEvents.investigationId, investigationIds)).orderBy(asc(agentEvents.investigationId), asc(agentEvents.sequenceNumber))
      : [];
    const eventsByInvestigation = new Map<number, typeof events>();
    for (const event of events) {
      const existing = eventsByInvestigation.get(event.investigationId) ?? [];
      existing.push(event);
      eventsByInvestigation.set(event.investigationId, existing);
    }

    const auditScopes: SQL[] = [and(eq(auditLogs.entityType, "exception"), eq(auditLogs.entityId, exceptionId))!];
    if (investigationIds.length > 0) auditScopes.push(and(eq(auditLogs.entityType, "investigation"), inArray(auditLogs.entityId, investigationIds))!);
    if (reviews.length > 0) auditScopes.push(and(eq(auditLogs.entityType, "review_case"), inArray(auditLogs.entityId, reviews.map((row) => row.id)))!);
    const audits = await db.select().from(auditLogs).where(or(...auditScopes)).orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));

    return {
      ...context,
      investigations: investigationRows.map((investigation) => ({
        investigation,
        events: eventsByInvestigation.get(investigation.id) ?? [],
      })),
      reviewCases: reviews,
      auditTrail: audits,
    };
  });

  app.get<{ Querystring: ExceptionListQuery }>("/api/exceptions", async (request, reply) => {
    const runId = request.query.runId === undefined ? undefined : parsePositiveId(request.query.runId);
    const limit = parseNonNegativeInteger(request.query.limit, 100);
    const offset = parseNonNegativeInteger(request.query.offset, 0);
    if (runId === null || limit === null || limit < 1 || limit > 500 || offset === null) {
      return reply.code(400).send({ error: { code: "INVALID_PAGINATION", message: "runId must be positive; limit must be 1-500; offset must be non-negative" } } satisfies ApiErrorBody);
    }
    if (request.query.status && !exceptionStatuses.has(request.query.status)) {
      return reply.code(400).send({ error: { code: "INVALID_EXCEPTION_STATUS", message: `Unsupported exception status: ${request.query.status}` } } satisfies ApiErrorBody);
    }
    if (request.query.type && !exceptionTypes.has(request.query.type)) {
      return reply.code(400).send({ error: { code: "INVALID_EXCEPTION_TYPE", message: `Unsupported exception type: ${request.query.type}` } } satisfies ApiErrorBody);
    }

    const conditions: SQL[] = [];
    if (runId !== undefined) conditions.push(eq(exceptions.runId, runId));
    if (request.query.status) conditions.push(eq(exceptions.status, request.query.status));
    if (request.query.type) conditions.push(eq(exceptions.type, request.query.type));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      db.select().from(exceptions).where(where).orderBy(desc(exceptions.id)).limit(limit).offset(offset),
      db.select({ value: count() }).from(exceptions).where(where),
    ]);
    const latestByException = new Map<number, typeof investigations.$inferSelect>();
    if (rows.length > 0) {
      const investigationRows = await db.select().from(investigations)
        .where(inArray(investigations.exceptionId, rows.map((row) => row.id)))
        .orderBy(desc(investigations.id));
      for (const investigation of investigationRows) {
        if (!latestByException.has(investigation.exceptionId)) latestByException.set(investigation.exceptionId, investigation);
      }
    }

    return {
      items: rows.map((exception) => ({ exception, latestInvestigation: latestByException.get(exception.id) ?? null })),
      pagination: { total: totalRows[0]!.value, limit, offset },
    };
  });
}
