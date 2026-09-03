import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { ModelCaller } from "../src/agent/loop.js";
import { db } from "../src/db/client.js";
import { batches, exceptions, investigations, merchants, reconciliationRuns } from "../src/db/schema.js";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance;
let exceptionId: number;
let resolvedExceptionId: number;
let evidenceDirectory: string;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "HTTP Investigation Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `http-investigate-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
  }).returning();
  const [run] = await db.insert(reconciliationRuns).values({ batchId: batch!.id, status: "completed" }).returning();
  const created = await db.insert(exceptions).values([
    {
      runId: run!.id,
      type: "UNKNOWN_ADJUSTMENT",
      severity: "medium",
      status: "OPEN",
      amountAtRiskPaise: 500,
      primaryRecordType: "adjustment",
      primaryRecordId: 987_001,
      deterministicEvidenceJson: { adjustmentId: 987_001 },
    },
    {
      runId: run!.id,
      type: "FEE_MISMATCH",
      severity: "medium",
      status: "AUTO_RESOLVED",
      amountAtRiskPaise: 100,
      resolvedAt: new Date(),
    },
  ]).returning();
  exceptionId = created[0]!.id;
  resolvedExceptionId = created[1]!.id;
  evidenceDirectory = await mkdtemp(path.join(os.tmpdir(), "settleguard-http-investigate-"));
  const modelCaller: ModelCaller = async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        exceptionId,
        rootCause: "insufficient_evidence",
        confidence: 0.4,
        evidence: [{ recordId: "adjustment:987001", reason: "No source record is available to verify the adjustment." }],
        recommendedAction: "no_action",
        requiresHumanApproval: true,
        explanation: "Preserve the exception for human investigation.",
      }),
    }],
    stop_reason: "end_turn",
  });
  app = buildApp({ logger: false }, { modelCaller, evidenceOutputDirectory: evidenceDirectory });
});

afterAll(async () => {
  await app.close();
  await rm(evidenceDirectory, { recursive: true, force: true });
});

describe("POST /api/exceptions/:id/investigate", () => {
  it("runs a model-injected investigation and persists its evidence artifact", async () => {
    const response = await app.inject({ method: "POST", url: `/api/exceptions/${exceptionId}/investigate` });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.investigation).toMatchObject({
      investigationId: expect.any(Number),
      outcomeStatus: "completed",
      resolutionDecision: { policy: { decision: "human_review" } },
    });
    expect(existsSync(body.investigation.evidencePagePath)).toBe(true);
  });

  it("rejects concurrent work and closed exceptions", async () => {
    await db.insert(investigations).values({ exceptionId, status: "in_progress" });
    const active = await app.inject({ method: "POST", url: `/api/exceptions/${exceptionId}/investigate` });
    expect(active.statusCode).toBe(409);
    expect(active.json()).toMatchObject({ error: { code: "INVESTIGATION_IN_PROGRESS" } });
    const closed = await app.inject({ method: "POST", url: `/api/exceptions/${resolvedExceptionId}/investigate` });
    expect(closed.statusCode).toBe(409);
    expect(closed.json()).toMatchObject({ error: { code: "EXCEPTION_NOT_OPEN" } });
  });

  it("returns stable errors for invalid and missing exception IDs", async () => {
    const invalid = await app.inject({ method: "POST", url: "/api/exceptions/nope/investigate" });
    expect(invalid.statusCode).toBe(400);
    const missing = await app.inject({ method: "POST", url: "/api/exceptions/2147483647/investigate" });
    expect(missing.statusCode).toBe(404);
  });
});
