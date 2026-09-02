import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { exceptions, investigations } from "../../db/schema.js";
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
