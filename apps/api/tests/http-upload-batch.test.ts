import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/http/app.js";

const datasetDirectory = fileURLToPath(new URL("../../../datasets/agent-slice", import.meta.url));
const requiredFiles = ["payments.csv", "refunds.csv", "settlements.csv", "bank_transactions.csv", "adjustments.csv"];
let app: FastifyInstance;

function multipartPayload(batchName: string, fileNames = requiredFiles) {
  const boundary = `settleguard-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="batchName"\r\n\r\n${batchName}\r\n`));
  for (const fileName of fileNames) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fileName}"\r\nContent-Type: text/csv\r\n\r\n`));
    chunks.push(readFileSync(`${datasetDirectory}/${fileName}`));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

beforeAll(() => {
  app = buildApp({ logger: false });
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/batches/upload", () => {
  it("ingests the five uploaded CSV files", async () => {
    const batchName = `http-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response = await app.inject({ method: "POST", url: "/api/batches/upload", ...multipartPayload(batchName) });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.ingestion.batchId).toEqual(expect.any(Number));
    expect(Object.values(body.ingestion.counts).reduce((sum: number, value) => sum + Number(value), 0)).toBeGreaterThan(0);

    const detail = await app.inject({ method: "GET", url: `/api/batches/${body.ingestion.batchId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().batch.name).toBe(batchName);
  });

  it("rejects non-multipart and incomplete uploads", async () => {
    const plain = await app.inject({ method: "POST", url: "/api/batches/upload", payload: {} });
    expect(plain.statusCode).toBe(415);
    expect(plain.json()).toMatchObject({ error: { code: "MULTIPART_REQUIRED" } });

    const incomplete = await app.inject({
      method: "POST",
      url: "/api/batches/upload",
      ...multipartPayload(`http-incomplete-${Date.now()}`, requiredFiles.slice(0, 4)),
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json()).toMatchObject({ error: { code: "MISSING_UPLOAD_FILES" } });
  });
});
