import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { adjustments, batches, exceptions, settlements } from "../src/db/schema.js";
import { executeTool } from "../src/agent/tools.js";

// Looks up the agent-slice batch's real ids dynamically rather than
// hardcoding auto-increment values, which would go stale the moment
// the database is reset or re-seeded.
let exceptionId: number;
let settlementId: number;
let adjustmentId: number;

beforeAll(async () => {
  const [batch] = await db.select().from(batches).where(eq(batches.name, "agent-slice-001"));
  if (!batch) throw new Error('Run `npm run ingest -- ../../datasets/agent-slice agent-slice-001` and reconcile it before running this test.');

  const [exc] = await db.select().from(exceptions).where(eq(exceptions.type, "UNKNOWN_ADJUSTMENT"));
  if (!exc) throw new Error("No UNKNOWN_ADJUSTMENT exception found — reconcile the agent-slice batch first.");
  exceptionId = exc.id;
  adjustmentId = exc.primaryRecordId!;

  const [adj] = await db.select().from(adjustments).where(eq(adjustments.id, adjustmentId));
  settlementId = adj!.settlementId!;
});

describe("get_exception", () => {
  it("returns the real exception record", async () => {
    const result = (await executeTool("get_exception", { exceptionId })) as any;
    expect(result.type).toBe("UNKNOWN_ADJUSTMENT");
    expect(result.id).toBe(exceptionId);
  });

  it("returns a clear error for a nonexistent id", async () => {
    const result = (await executeTool("get_exception", { exceptionId: 999999999 })) as any;
    expect(result.error).toMatch(/No exception/);
  });
});

describe("get_settlement", () => {
  it("returns the settlement the adjustment belongs to", async () => {
    const result = (await executeTool("get_settlement", { settlementId })) as any;
    expect(result.id).toBe(settlementId);
    expect(result.externalSettlementId).toMatch(/^SET_/);
  });
});

describe("get_adjustment", () => {
  it("returns the adjustment with a null source_reference — the actual thing under investigation", async () => {
    const result = (await executeTool("get_adjustment", { adjustmentId })) as any;
    expect(result.id).toBe(adjustmentId);
    expect(result.sourceReference).toBeNull();
  });
});

describe("get_related_payments", () => {
  it("returns the payments confirmed as part of this settlement", async () => {
    const result = (await executeTool("get_related_payments", { settlementId })) as any;
    expect(Array.isArray(result.payments)).toBe(true);
    expect(result.payments.length).toBeGreaterThan(0);
    for (const p of result.payments) expect(p.status).toBe("captured");
  });
});

describe("get_related_refunds", () => {
  it("returns the refunds confirmed as part of this settlement", async () => {
    const result = (await executeTool("get_related_refunds", { settlementId })) as any;
    expect(Array.isArray(result.refunds)).toBe(true);
    // agent-slice was generated with exactly 3 refunds — see scripts/generate-dataset.ts
    expect(result.refunds.length).toBe(3);
  });
});

describe("executeTool", () => {
  it("returns a clear error for an unknown tool name rather than throwing", async () => {
    const result = (await executeTool("delete_everything", {})) as any;
    expect(result.error).toMatch(/Unknown tool/);
  });
});
