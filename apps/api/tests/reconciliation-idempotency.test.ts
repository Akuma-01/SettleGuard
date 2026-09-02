import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { batches, merchants, payments, settlementItems, settlements } from "../src/db/schema.js";
import { runReconciliation } from "../src/reconciliation/run.js";

let batchId: number;
let settlementId: number;
let paymentId: number;

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "Reconciliation Idempotency Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `reconciliation-idempotency-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
    recordCount: 2,
  }).returning();
  batchId = batch!.id;
  const [payment] = await db.insert(payments).values({
    batchId,
    externalPaymentId: "idempotent-payment",
    amountPaise: 100_000,
    status: "captured",
    capturedAt: new Date("2026-09-01T10:00:00Z"),
  }).returning();
  paymentId = payment!.id;
  const [settlement] = await db.insert(settlements).values({
    batchId,
    externalSettlementId: "idempotent-settlement",
    grossAmountPaise: 100_000,
    feeAmountPaise: 2_000,
    taxAmountPaise: 360,
    adjustmentAmountPaise: 0,
    reportedNetPaise: 97_640,
    settledAt: new Date("2026-09-02T10:00:00Z"),
  }).returning();
  settlementId = settlement!.id;
});

describe("runReconciliation idempotency", () => {
  it("does not duplicate derived settlement items across fresh runs", async () => {
    const first = await runReconciliation(batchId);
    const afterFirst = await db.select().from(settlementItems).where(eq(settlementItems.settlementId, settlementId));
    const second = await runReconciliation(batchId);
    const afterSecond = await db.select().from(settlementItems).where(eq(settlementItems.settlementId, settlementId));

    expect(first.runId).not.toBe(second.runId);
    expect(afterFirst).toHaveLength(1);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]).toMatchObject({ settlementId, paymentId, refundId: null, itemType: "payment", amountPaise: 100_000 });
  });
});
