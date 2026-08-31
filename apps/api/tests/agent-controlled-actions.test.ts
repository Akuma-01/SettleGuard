import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { controlledActionDefinitions, executeControlledAction, type ActionAuthorization } from "../src/agent/controlled-actions.js";
import { db } from "../src/db/client.js";
import { auditLogs, exceptions, reviewCases } from "../src/db/schema.js";

let exceptionId: number;
const authorization: ActionAuthorization = {
  actorType: "system",
  actorId: "day7-controlled-action-test",
  allowedActions: new Set(["create_review_case", "propose_adjustment"]),
  reason: "integration test of trusted action boundary",
};

beforeAll(async () => {
  const [exception] = await db.select().from(exceptions).where(eq(exceptions.type, "UNKNOWN_ADJUSTMENT"));
  if (!exception) throw new Error("Reconcile the agent-slice batch before this test.");
  exceptionId = exception.id;
});

describe("controlled action catalog", () => {
  it("is separate from the model's read/analysis tools", () => {
    expect(controlledActionDefinitions.map((tool) => tool.name)).toEqual(["create_review_case", "propose_adjustment"]);
    for (const tool of controlledActionDefinitions) expect(tool.input_schema.additionalProperties).toBe(false);
  });
});

describe("authorization boundary", () => {
  it("denies model arguments without trusted authorization", async () => {
    const before = await db.select().from(reviewCases).where(eq(reviewCases.exceptionId, exceptionId));
    const result = (await executeControlledAction("create_review_case", {
      exceptionId,
      proposedAction: "model_claims_it_is_authorized",
      authorization: true,
    })) as any;
    const after = await db.select().from(reviewCases).where(eq(reviewCases.exceptionId, exceptionId));
    expect(result.error).toMatch(/denied/i);
    expect(after).toHaveLength(before.length);
  });
});

describe("create_review_case", () => {
  it("creates one audited case and is idempotent on retry", async () => {
    const input = { exceptionId, proposedAction: "day7_verify_gateway_source" };
    const first = (await executeControlledAction("create_review_case", input, authorization)) as any;
    const second = (await executeControlledAction("create_review_case", input, authorization)) as any;
    expect(second.reviewCase.id).toBe(first.reviewCase.id);
    expect(second.created).toBe(false);

    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first.reviewCase.id));
    expect(logs.some((log) => log.action === "create_review_case" && log.actorId === authorization.actorId)).toBe(true);
  });
});

describe("propose_adjustment", () => {
  it("records a proposal for review without changing financial source records", async () => {
    const result = (await executeControlledAction("propose_adjustment", {
      exceptionId,
      amountPaise: -12_345,
      reason: "day7 test proposal based on verified evidence",
    }, authorization)) as any;
    expect(result.reviewCase.status).toBe("pending");
    expect(JSON.parse(result.reviewCase.proposedAction)).toEqual({
      type: "propose_adjustment",
      amountPaise: -12_345,
      reason: "day7 test proposal based on verified evidence",
    });
  });

  it("rejects a zero-value or unsupported proposal", async () => {
    const result = (await executeControlledAction("propose_adjustment", {
      exceptionId,
      amountPaise: 0,
      reason: "invalid",
    }, authorization)) as any;
    expect(result.error).toBe("Invalid tool input");
  });
});
