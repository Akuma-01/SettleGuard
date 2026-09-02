import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db/client.js";
import { batches, merchants, payments, reconciliationRuns } from "../src/db/schema.js";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance;
let batchId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "HTTP Batch Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `http-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
    recordCount: 2,
  }).returning();
  batchId = batch!.id;
  await db.insert(payments).values([
    { batchId, externalPaymentId: "http-payment-1", amountPaise: 100, status: "captured", capturedAt: new Date() },
    { batchId, externalPaymentId: "http-payment-2", amountPaise: 200, status: "captured", capturedAt: new Date() },
  ]);
  await db.insert(reconciliationRuns).values([
    { batchId, status: "completed", matchRate: 1 },
    { batchId, status: "completed", matchRate: 0.5 },
  ]);
  app = buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/batches/:id", () => {
  it("returns dashboard-ready source counts and newest-first run history", async () => {
    const response = await app.inject({ method: "GET", url: `/api/batches/${batchId}` });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.batch).toMatchObject({ id: batchId, status: "completed", recordCount: 2 });
    expect(body.batch.merchantName).toBeTruthy();
    expect(body.sourceCounts).toEqual({ payments: 2, refunds: 0, settlements: 0, bankTransactions: 0, adjustments: 0, total: 2 });
    expect(body.reconciliationRuns).toHaveLength(2);
    expect(body.reconciliationRuns[0].id).toBeGreaterThan(body.reconciliationRuns[1].id);
  });

  it("rejects malformed IDs", async () => {
    const response = await app.inject({ method: "GET", url: "/api/batches/not-a-number" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "INVALID_BATCH_ID", message: "Batch id must be a positive integer" } });
  });

  it("returns a resource-specific 404", async () => {
    const response = await app.inject({ method: "GET", url: "/api/batches/2147483647" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: "BATCH_NOT_FOUND", message: "No batch with id 2147483647" } });
  });
});
