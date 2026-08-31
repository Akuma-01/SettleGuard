import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { executeTool } from "../src/agent/tools.js";
import { db } from "../src/db/client.js";
import { bankTransactions, batches, settlementItems, settlements } from "../src/db/schema.js";
import { calculateFeePaise, calculateTaxPaise } from "../src/reconciliation/money.js";

let settlementId: number;
let bankTransactionId: number;
let paymentIds: number[];

beforeAll(async () => {
  const [batch] = await db.select().from(batches).where(eq(batches.name, "agent-slice-001"));
  if (!batch) throw new Error("Run and reconcile the agent-slice batch before this test.");
  const [settlement] = await db.select().from(settlements).where(eq(settlements.batchId, batch.id));
  const [bank] = await db.select().from(bankTransactions).where(eq(bankTransactions.batchId, batch.id));
  if (!settlement || !bank) throw new Error("Agent-slice settlement or bank credit is missing.");
  settlementId = settlement.id;
  bankTransactionId = bank.id;
  const items = await db.select().from(settlementItems).where(eq(settlementItems.settlementId, settlementId));
  paymentIds = items.flatMap((item) => item.paymentId === null ? [] : [item.paymentId]);
});

describe("calculate_expected_settlement", () => {
  it("reconstructs the stored expected net from confirmed records", async () => {
    const result = (await executeTool("calculate_expected_settlement", { settlementId })) as any;
    expect(result.settlementId).toBe(settlementId);
    expect(result.grossPaise).toBeGreaterThan(0);
    expect(result.refundPaise).toBeGreaterThan(0);
    expect(result.expectedNetPaise).toBe(result.storedExpectedNetPaise);
    expect(result.agreesWithStoredValue).toBe(true);
  });
});

describe("calculate_expected_fees", () => {
  it("uses deterministic fee policy and de-duplicates repeated IDs", async () => {
    const result = (await executeTool("calculate_expected_fees", { paymentIds: [...paymentIds, paymentIds[0]] })) as any;
    expect(result.paymentIds).toHaveLength(paymentIds.length);
    expect(result.feePaise).toBe(calculateFeePaise(result.grossPaise));
    expect(result.taxPaise).toBe(calculateTaxPaise(result.feePaise));
  });

  it("does not silently calculate a partial result when a payment is missing", async () => {
    const result = (await executeTool("calculate_expected_fees", { paymentIds: [paymentIds[0], 999_999_999] })) as any;
    expect(result.error).toMatch(/not found/);
    expect(result.missingPaymentIds).toEqual([999_999_999]);
  });
});

describe("compare_settlement_to_bank", () => {
  it("returns exact-reference credits with code-computed deltas", async () => {
    const result = (await executeTool("compare_settlement_to_bank", { settlementId })) as any;
    const match = result.matches.find((candidate: any) => candidate.bankTransactionId === bankTransactionId);
    expect(match).toBeDefined();
    expect(match.deltaPaise).toBe(match.amountPaise - result.expectedNetPaise);
  });
});

describe("score_candidate_match", () => {
  it("returns transparent scoring criteria for a candidate pair", async () => {
    const result = (await executeTool("score_candidate_match", { settlementId, bankTransactionId })) as any;
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.criteria.sameBatch).toBe(true);
    expect(result.criteria.creditDirection).toBe(true);
    expect(typeof result.criteria.amountMatch).toBe("boolean");
  });

  it("rejects malformed IDs", async () => {
    const result = (await executeTool("score_candidate_match", { settlementId: -1, bankTransactionId })) as any;
    expect(result.error).toBe("Invalid tool input");
  });
});
