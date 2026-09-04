import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db/client.js";
import { batches, exceptions, matches, merchants, reconciliationRuns } from "../src/db/schema.js";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance;
let runId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "HTTP Run Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `http-run-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
  }).returning();
  const [run] = await db.insert(reconciliationRuns).values({
    batchId: batch!.id,
    status: "completed",
    totalRecords: 10,
    matchedRecords: 8,
    unmatchedRecords: 2,
    matchRate: 0.8,
    exceptionCount: 2,
    autoResolvedCount: 1,
    humanReviewCount: 1,
    unresolvedCount: 0,
  }).returning();
  runId = run!.id;
  await db.insert(exceptions).values([
    { runId, type: "FEE_MISMATCH", severity: "medium", status: "OPEN", amountAtRiskPaise: 500 },
    { runId, type: "FEE_MISMATCH", severity: "medium", status: "AUTO_RESOLVED", amountAtRiskPaise: 300, resolvedAt: new Date() },
  ]);
  await db.insert(matches).values({
    runId,
    sourceType: "payment",
    sourceId: 1,
    targetType: "settlement",
    targetId: 1,
    matchType: "stage_b",
    status: "matched",
  });
  app = buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("reconciliation run HTTP resources", () => {
  it("returns run context and computed exception breakdown", async () => {
    const response = await app.inject({ method: "GET", url: `/api/runs/${runId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      run: { id: runId, status: "completed", totalRecords: 10, merchantName: expect.any(String) },
      matchCount: 1,
      exceptionsByType: { FEE_MISMATCH: 2 },
      featuredException: { type: "FEE_MISMATCH", severity: "medium", amountAtRiskPaise: 500 },
    });
  });

  it("returns dashboard metrics without counting resolved money as still at risk", async () => {
    const response = await app.inject({ method: "GET", url: `/api/runs/${runId}/metrics` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runId,
      status: "completed",
      records: { total: 10, matched: 8, unmatched: 2, matchRate: 0.8 },
      exceptions: { total: 2, byStatus: { OPEN: 1, AUTO_RESOLVED: 1 }, amountAtRiskPaise: 500 },
      resolutions: { autoResolved: 1, humanReview: 1, unresolved: 0 },
    });
  });

  it("uses stable errors for invalid and missing run IDs", async () => {
    const invalid = await app.inject({ method: "GET", url: "/api/runs/nope" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "INVALID_RUN_ID" } });
    const missing = await app.inject({ method: "GET", url: "/api/runs/2147483647/metrics" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "RUN_NOT_FOUND" } });
  });
});
