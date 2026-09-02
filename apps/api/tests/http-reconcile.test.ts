import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db/client.js";
import { batches, merchants, reconciliationRuns } from "../src/db/schema.js";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance;
let batchId: number;
let busyBatchId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "HTTP Reconciliation Test" }).returning();
  const created = await db.insert(batches).values([
    {
      merchantId: merchant!.id,
      name: `http-reconcile-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      status: "completed",
      recordCount: 0,
    },
    {
      merchantId: merchant!.id,
      name: `http-reconcile-busy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      status: "completed",
      recordCount: 0,
    },
  ]).returning();
  batchId = created[0]!.id;
  busyBatchId = created[1]!.id;
  await db.insert(reconciliationRuns).values({ batchId: busyBatchId, status: "processing", startedAt: new Date() });
  app = buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/batches/:id/reconcile", () => {
  it("runs deterministic reconciliation and returns its measured summary", async () => {
    const response = await app.inject({ method: "POST", url: `/api/batches/${batchId}/reconcile` });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      run: {
        runId: expect.any(Number),
        totalRecords: 0,
        matchedRecords: 0,
        unmatchedRecords: 0,
        matchRate: 0,
        exceptionCount: 0,
        byType: {},
      },
    });
  });

  it("rejects a second active reconciliation for the same batch", async () => {
    const response = await app.inject({ method: "POST", url: `/api/batches/${busyBatchId}/reconcile` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "RECONCILIATION_IN_PROGRESS" } });
  });

  it("returns 404 without creating a run for a missing batch", async () => {
    const response = await app.inject({ method: "POST", url: "/api/batches/2147483647/reconcile" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "BATCH_NOT_FOUND", message: "No batch with id 2147483647" } });
  });
});
