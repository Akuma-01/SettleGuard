import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { db } from "../src/db/client.js";
import { agentEvents, auditLogs, batches, exceptions, investigations, merchants, reconciliationRuns, reviewCases } from "../src/db/schema.js";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance;
let exceptionId: number;
let investigationId: number;
let reviewCaseId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "HTTP Exception Detail Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `http-exception-detail-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
  }).returning();
  const [run] = await db.insert(reconciliationRuns).values({ batchId: batch!.id, status: "completed" }).returning();
  const [exception] = await db.insert(exceptions).values({
    runId: run!.id,
    type: "UNKNOWN_ADJUSTMENT",
    severity: "high",
    status: "OPEN",
    amountAtRiskPaise: 2_500,
    summary: "Unexplained adjustment",
    deterministicEvidenceJson: { adjustmentId: 42 },
  }).returning();
  exceptionId = exception!.id;
  const [investigation] = await db.insert(investigations).values({
    exceptionId,
    status: "completed",
    rootCause: "unknown_adjustment",
    confidence: 0.6,
    recommendedAction: "create_review_case",
  }).returning();
  investigationId = investigation!.id;
  await db.insert(agentEvents).values([
    { investigationId, sequenceNumber: 2, eventType: "tool_result", toolName: "get_adjustment", toolOutputJson: { id: 42 } },
    { investigationId, sequenceNumber: 1, eventType: "tool_call", toolName: "get_adjustment", toolInputJson: { adjustmentId: 42 } },
  ]);
  const [review] = await db.insert(reviewCases).values({ exceptionId, status: "pending", proposedAction: "create_review_case" }).returning();
  reviewCaseId = review!.id;
  await db.insert(auditLogs).values([
    { actorType: "system", action: "resolution_policy_decision", entityType: "investigation", entityId: investigationId },
    { actorType: "system", action: "create_review_case", entityType: "review_case", entityId: reviewCaseId },
    { actorType: "system", action: "exception_observed", entityType: "exception", entityId: exceptionId },
    { actorType: "system", action: "unrelated", entityType: "exception", entityId: exceptionId + 999_999 },
  ]);
  app = buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/exceptions/:id", () => {
  it("returns the complete explainability context with ordered events and scoped audits", async () => {
    const response = await app.inject({ method: "GET", url: `/api/exceptions/${exceptionId}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.exception).toMatchObject({ id: exceptionId, type: "UNKNOWN_ADJUSTMENT", amountAtRiskPaise: 2_500 });
    expect(body.run).toMatchObject({ id: expect.any(Number), status: "completed" });
    expect(body.batch).toMatchObject({ id: expect.any(Number), merchantName: expect.any(String) });
    expect(body.investigations).toHaveLength(1);
    expect(body.investigations[0].investigation.id).toBe(investigationId);
    expect(body.investigations[0].events.map((event: any) => event.sequenceNumber)).toEqual([1, 2]);
    expect(body.reviewCases).toEqual([expect.objectContaining({ id: reviewCaseId, status: "pending" })]);
    expect(body.auditTrail.map((audit: any) => audit.action)).toEqual(expect.arrayContaining([
      "resolution_policy_decision",
      "create_review_case",
      "exception_observed",
    ]));
    expect(body.auditTrail.map((audit: any) => audit.action)).not.toContain("unrelated");
  });

  it("returns stable validation and not-found errors", async () => {
    const invalid = await app.inject({ method: "GET", url: "/api/exceptions/nope" });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: "INVALID_EXCEPTION_ID" } });
    const missing = await app.inject({ method: "GET", url: "/api/exceptions/2147483647" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "EXCEPTION_NOT_FOUND" } });
  });
});
