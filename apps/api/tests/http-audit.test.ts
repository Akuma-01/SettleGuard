import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import { db } from "../src/db/client.js";
import { auditLogs } from "../src/db/schema.js";
import { buildApp } from "../src/http/app.js";

let app: FastifyInstance;
let entityId: number;

beforeAll(async () => {
  entityId = randomInt(1_000_000_000, 2_000_000_000);
  await db.insert(auditLogs).values([
    { actorType: "system", actorId: "policy", action: "resolution_policy_decision", entityType: "investigation", entityId },
    { actorType: "human", actorId: "reviewer-7", action: "review_approve", entityType: "review_case", entityId },
    { actorType: "system", actorId: "policy", action: "unrelated_action", entityType: "investigation", entityId: entityId + 1 },
  ]);
  app = buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("GET /api/audit", () => {
  it("filters audit history and returns newest-first bounded pagination", async () => {
    const response = await app.inject({ method: "GET", url: `/api/audit?entityId=${entityId}&limit=1&offset=0` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pagination).toEqual({ total: 2, limit: 1, offset: 0 });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ entityId, action: "review_approve" });
  });

  it("combines entity, action, and actor filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/audit?entityType=investigation&entityId=${entityId}&action=resolution_policy_decision&actorType=system`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ entityType: "investigation", entityId, action: "resolution_policy_decision", actorType: "system" }],
      pagination: { total: 1 },
    });
  });

  it("rejects unsafe filters and unbounded requests", async () => {
    const unsafe = await app.inject({ method: "GET", url: "/api/audit?action=bad%20filter" });
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.json()).toMatchObject({ error: { code: "INVALID_AUDIT_FILTER" } });
    const unbounded = await app.inject({ method: "GET", url: "/api/audit?limit=501" });
    expect(unbounded.statusCode).toBe(400);
    expect(unbounded.json()).toMatchObject({ error: { code: "INVALID_AUDIT_PAGINATION" } });
  });
});
