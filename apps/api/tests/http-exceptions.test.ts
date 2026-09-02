import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db/client.js";
import { batches, exceptions, investigations, merchants, reconciliationRuns } from "../src/db/schema.js";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance;
let runId: number;
let newestExceptionId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "HTTP Exception Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `http-exceptions-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
  }).returning();
  const [run] = await db.insert(reconciliationRuns).values({ batchId: batch!.id, status: "completed" }).returning();
  runId = run!.id;
  const created = await db.insert(exceptions).values([
    { runId, type: "FEE_MISMATCH", severity: "medium", status: "OPEN", amountAtRiskPaise: 500 },
    { runId, type: "UNKNOWN_ADJUSTMENT", severity: "high", status: "UNRESOLVED", amountAtRiskPaise: 900 },
    { runId, type: "FEE_MISMATCH", severity: "medium", status: "AUTO_RESOLVED", amountAtRiskPaise: 300, resolvedAt: new Date() },
  ]).returning();
  newestExceptionId = created[2]!.id;
  await db.insert(investigations).values([
    { exceptionId: newestExceptionId, status: "completed", confidence: 0.7, recommendedAction: "create_review_case" },
    { exceptionId: newestExceptionId, status: "completed", confidence: 0.99, recommendedAction: "rerun_reconciliation" },
  ]);
  app = buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/exceptions", () => {
  it("returns newest-first exceptions with only the latest investigation summary", async () => {
    const response = await app.inject({ method: "GET", url: `/api/exceptions?runId=${runId}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pagination).toEqual({ total: 3, limit: 100, offset: 0 });
    expect(body.items.map((item: any) => item.exception.id)).toEqual([...body.items.map((item: any) => item.exception.id)].sort((a: number, b: number) => b - a));
    expect(body.items[0]).toMatchObject({
      exception: { id: newestExceptionId },
      latestInvestigation: { confidence: 0.99, recommendedAction: "rerun_reconciliation" },
    });
  });

  it("combines run, status, and type filters with bounded pagination", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/exceptions?runId=${runId}&status=OPEN&type=FEE_MISMATCH&limit=1&offset=0`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ exception: { runId, status: "OPEN", type: "FEE_MISMATCH" } }],
      pagination: { total: 1, limit: 1, offset: 0 },
    });
  });

  it("rejects unsupported filters and unbounded pagination", async () => {
    const invalidStatus = await app.inject({ method: "GET", url: "/api/exceptions?status=deleted" });
    expect(invalidStatus.statusCode).toBe(400);
    expect(invalidStatus.json()).toMatchObject({ error: { code: "INVALID_EXCEPTION_STATUS" } });
    const invalidLimit = await app.inject({ method: "GET", url: "/api/exceptions?limit=501" });
    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidLimit.json()).toMatchObject({ error: { code: "INVALID_PAGINATION" } });
  });
});
