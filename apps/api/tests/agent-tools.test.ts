import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { adjustments, bankTransactions, batches, exceptions, payments, reconciliationRuns, refunds, settlements } from "../src/db/schema.js";
import { executeTool, toolDefinitions } from "../src/agent/tools.js";

// Looks up the agent-slice batch's real ids dynamically rather than
// hardcoding auto-increment values, which would go stale the moment
// the database is reset or re-seeded.
let exceptionId: number;
let settlementId: number;
let adjustmentId: number;
let paymentId: number;
let refundId: number;
let bankTransactionId: number;
let bankAmountPaise: number;
let bankPostedAt: Date;
let bankReference: string | null;

beforeAll(async () => {
  const [batch] = await db.select().from(batches).where(eq(batches.name, "agent-slice-001"));
  if (!batch) throw new Error('Run `npm run ingest -- ../../datasets/agent-slice agent-slice-001` and reconcile it before running this test.');

  const runs = await db.select({ id: reconciliationRuns.id }).from(reconciliationRuns).where(eq(reconciliationRuns.batchId, batch.id));
  const [exc] = runs.length === 0
    ? []
    : await db.select().from(exceptions).where(inArray(exceptions.runId, runs.map((run) => run.id)));
  if (!exc) throw new Error("No UNKNOWN_ADJUSTMENT exception found — reconcile the agent-slice batch first.");
  exceptionId = exc.id;
  adjustmentId = exc.primaryRecordId!;

  const [adj] = await db.select().from(adjustments).where(eq(adjustments.id, adjustmentId));
  settlementId = adj!.settlementId!;

  const [payment] = await db.select().from(payments).where(eq(payments.batchId, batch.id));
  const [refund] = await db.select().from(refunds).where(eq(refunds.batchId, batch.id));
  const [bank] = await db.select().from(bankTransactions).where(eq(bankTransactions.batchId, batch.id));
  if (!payment || !refund || !bank) throw new Error("Agent-slice evidence records are incomplete.");
  paymentId = payment.id;
  refundId = refund.id;
  bankTransactionId = bank.id;
  bankAmountPaise = bank.amountPaise;
  bankPostedAt = bank.postedAt;
  bankReference = bank.reference;
});

describe("tool definitions", () => {
  it("exposes the complete read-only evidence catalog and forbids extra input properties", () => {
    expect(toolDefinitions.map((tool) => tool.name)).toEqual([
      "get_exception", "get_payment", "get_refund", "get_settlement", "get_bank_transaction",
      "get_adjustment", "get_adjustments", "get_related_payments", "get_related_refunds", "find_bank_credits",
      "calculate_expected_settlement", "calculate_expected_fees", "compare_settlement_to_bank", "score_candidate_match",
    ]);
    for (const tool of toolDefinitions) expect(tool.input_schema.additionalProperties).toBe(false);
  });
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

describe("direct record tools", () => {
  it("fetches a payment, refund, and bank transaction by ID", async () => {
    const payment = (await executeTool("get_payment", { paymentId })) as any;
    const refund = (await executeTool("get_refund", { refundId })) as any;
    const bank = (await executeTool("get_bank_transaction", { bankTransactionId })) as any;
    expect(payment.id).toBe(paymentId);
    expect(refund.id).toBe(refundId);
    expect(bank.id).toBe(bankTransactionId);
  });
});

describe("get_adjustment", () => {
  it("returns the adjustment with a null source_reference — the actual thing under investigation", async () => {
    const result = (await executeTool("get_adjustment", { adjustmentId })) as any;
    expect(result.id).toBe(adjustmentId);
    expect(result.sourceReference).toBeNull();
  });
});

describe("get_adjustments", () => {
  it("returns all adjustments attached to the settlement", async () => {
    const result = (await executeTool("get_adjustments", { settlementId })) as any;
    expect(result.adjustments.some((adjustment: any) => adjustment.id === adjustmentId)).toBe(true);
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
  it("rejects malformed model input before querying", async () => {
    const wrongType = (await executeTool("get_payment", { paymentId: "1" })) as any;
    const extraProperty = (await executeTool("get_payment", { paymentId, destructive: true })) as any;
    expect(wrongType.error).toBe("Invalid tool input");
    expect(extraProperty.error).toBe("Invalid tool input");
  });

  it("finds credit candidates deterministically and validates the date window", async () => {
    const startDate = new Date(bankPostedAt.getTime() - 86_400_000).toISOString();
    const endDate = new Date(bankPostedAt.getTime() + 86_400_000).toISOString();
    const result = (await executeTool("find_bank_credits", {
      amountPaise: bankAmountPaise,
      startDate,
      endDate,
      ...(bankReference ? { reference: bankReference.slice(0, 5).toLowerCase() } : {}),
    })) as any;
    expect(result.bankTransactions.some((bank: any) => bank.id === bankTransactionId)).toBe(true);

    const invalid = (await executeTool("find_bank_credits", {
      amountPaise: bankAmountPaise,
      startDate: endDate,
      endDate: startDate,
    })) as any;
    expect(invalid.error).toBe("Invalid tool input");
  });

  it("returns a clear error for an unknown tool name rather than throwing", async () => {
    const result = (await executeTool("delete_everything", {})) as any;
    expect(result.error).toMatch(/Unknown tool/);
  });
});
