import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { batches, exceptions, investigations, reviewCases } from "../src/db/schema.js";
import { investigateException } from "../src/agent/investigate.js";
import type { ModelCaller, ModelResponse } from "../src/agent/loop.js";

let exceptionId: number;
let adjustmentId: number;

beforeAll(async () => {
  const [batch] = await db.select().from(batches).where(eq(batches.name, "agent-slice-001"));
  if (!batch) throw new Error("Run and reconcile the agent-slice batch before running this test.");
  const [exc] = await db.select().from(exceptions).where(eq(exceptions.type, "UNKNOWN_ADJUSTMENT"));
  exceptionId = exc!.id;
  adjustmentId = exc!.primaryRecordId!;
});

function textResponse(text: string): ModelResponse {
  return { content: [{ type: "text", text }], stop_reason: "end_turn" };
}
function toolUseResponse(name: string, input: Record<string, unknown>): ModelResponse {
  return { content: [{ type: "tool_use", id: "t1", name, input }], stop_reason: "tool_use" };
}

describe("investigateException — full vertical slice, scripted model", () => {
  const outputPath = path.resolve("/tmp", "test-investigation-evidence.html");

  it("wires load -> agent investigates -> policy -> evidence page end to end", async () => {
    let call = 0;
    const scriptedCaller: ModelCaller = async () => {
      call++;
      if (call === 1) return toolUseResponse("get_adjustment", { adjustmentId });
      return textResponse(
        JSON.stringify({
          exceptionId,
          rootCause: "unknown_adjustment",
          confidence: 0.5,
          evidence: [{ recordId: `adjustment:${adjustmentId}`, reason: "source_reference is null, confirmed via get_adjustment" }],
          recommendedAction: "create_review_case",
          requiresHumanApproval: true,
          explanation: "The deduction has no linked source record; a human should confirm against the payment gateway's own records before resolving.",
        }),
      );
    };

    const summary = await investigateException(exceptionId, scriptedCaller, outputPath);

    // 1. Outcome
    expect(summary.outcomeStatus).toBe("completed");

    // 2. investigations row was written with the right structured fields
    const [invRow] = await db.select().from(investigations).where(eq(investigations.id, summary.investigationId));
    expect(invRow!.status).toBe("completed");
    expect(invRow!.recommendedAction).toBe("create_review_case");
    expect(invRow!.requiresHumanApproval).toBe(true);

    // 3. Policy correctly opened a review case, since requiresHumanApproval was true
    const cases = await db.select().from(reviewCases).where(eq(reviewCases.exceptionId, exceptionId));
    expect(cases.length).toBeGreaterThan(0);
    expect(summary.policyDecision).toMatch(/Review case #\d+ created/);

    // 4. Evidence page was actually written to disk and contains the real content
    expect(existsSync(outputPath)).toBe(true);
    const html = readFileSync(outputPath, "utf-8");
    expect(html).toContain("get_adjustment");
    expect(html).toContain("create_review_case");
    expect(html).toContain("Review case");
  });

  it("cleanup", () => {
    if (existsSync(outputPath)) unlinkSync(outputPath);
  });
});
