import { and, count, desc, eq, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../../db/client.js";
import { auditLogs } from "../../db/schema.js";
import type { ApiErrorBody } from "../app.js";
import { parsePositiveId } from "../params.js";

interface AuditQuery {
  entityType?: string;
  entityId?: string;
  action?: string;
  actorType?: string;
  limit?: string;
  offset?: string;
}

function boundedInteger(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function validFilter(value: string | undefined): boolean {
  return value === undefined || (/^[a-zA-Z0-9_-]+$/.test(value) && value.length <= 100);
}

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: AuditQuery }>("/api/audit", async (request, reply) => {
    const entityId = request.query.entityId === undefined ? undefined : parsePositiveId(request.query.entityId);
    const limit = boundedInteger(request.query.limit, 100);
    const offset = boundedInteger(request.query.offset, 0);
    if (entityId === null || limit === null || limit < 1 || limit > 500 || offset === null) {
      return reply.code(400).send({ error: { code: "INVALID_AUDIT_PAGINATION", message: "entityId must be positive; limit must be 1-500; offset must be non-negative" } } satisfies ApiErrorBody);
    }
    if (![request.query.entityType, request.query.action, request.query.actorType].every(validFilter)) {
      return reply.code(400).send({ error: { code: "INVALID_AUDIT_FILTER", message: "Audit filters must contain only letters, numbers, underscores, or hyphens" } } satisfies ApiErrorBody);
    }

    const conditions: SQL[] = [];
    if (request.query.entityType) conditions.push(eq(auditLogs.entityType, request.query.entityType));
    if (entityId !== undefined) conditions.push(eq(auditLogs.entityId, entityId));
    if (request.query.action) conditions.push(eq(auditLogs.action, request.query.action));
    if (request.query.actorType) conditions.push(eq(auditLogs.actorType, request.query.actorType));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [items, totalRows] = await Promise.all([
      db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(limit).offset(offset),
      db.select({ value: count() }).from(auditLogs).where(where),
    ]);

    return { items, pagination: { total: totalRows[0]!.value, limit, offset } };
  });
}
