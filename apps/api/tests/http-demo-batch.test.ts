import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance;
const batchName = `http-demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;

beforeAll(() => {
  const demoDatasetDirectory = fileURLToPath(new URL("../../../datasets/agent-slice", import.meta.url));
  app = buildApp({ logger: false }, { demoDatasetDirectory });
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/batches/demo", () => {
  it("loads a bundled dataset and returns its measured ingestion summary", async () => {
    const response = await app.inject({ method: "POST", url: "/api/batches/demo", payload: { batchName } });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.ingestion).toMatchObject({
      batchId: expect.any(Number),
      counts: {
        payments: expect.any(Number),
        refunds: expect.any(Number),
        settlements: expect.any(Number),
        bankTransactions: expect.any(Number),
        adjustments: expect.any(Number),
      },
      errors: expect.any(Object),
    });
    expect(Object.values(body.ingestion.counts).reduce((sum: number, value) => sum + Number(value), 0)).toBeGreaterThan(0);

    const detail = await app.inject({ method: "GET", url: `/api/batches/${body.ingestion.batchId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().sourceCounts).toMatchObject({ ...body.ingestion.counts });
  });

  it("rejects duplicate and malformed batch names", async () => {
    const duplicate = await app.inject({ method: "POST", url: "/api/batches/demo", payload: { batchName } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: { code: "BATCH_ALREADY_EXISTS" } });
    const malformed = await app.inject({ method: "POST", url: "/api/batches/demo", payload: { batchName: "bad name!" } });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { code: "INVALID_DEMO_BATCH" } });
  });
});
