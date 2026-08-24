import { describe, expect, it } from "vitest";
import { reconcileSettlement } from "../src/reconciliation/settlement-reconciler.js";
import type { AdjustmentRecord, PaymentRecord, RefundRecord, SettlementRecord } from "../src/db/schema.js";

let idSeq = 1;
const nextId = () => idSeq++;

function mkPayment(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: nextId(),
    batchId: 1,
    externalPaymentId: `PAY_${nextId()}`,
    orderId: "ORDER_1",
    amountPaise: 100000, // ₹1,000.00
    currency: "INR",
    status: "captured",
    capturedAt: new Date("2026-03-05T10:00:00Z"),
    method: "card",
    merchantReference: "MREF_1",
    rawPayload: {},
    ...overrides,
  };
}

function mkSettlement(overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    id: nextId(),
    batchId: 1,
    externalSettlementId: "SET_20260305",
    grossAmountPaise: 100000,
    feeAmountPaise: 2000, // 2% of 100000
    taxAmountPaise: 360, // 18% of 2000
    adjustmentAmountPaise: 0,
    expectedNetPaise: null,
    reportedNetPaise: 97640,
    settledAt: new Date("2026-03-06T18:00:00Z"), // T+1 — capture day is 2026-03-05
    bankReference: "UTR20260305001",
    rawPayload: {},
    ...overrides,
  };
}

describe("reconcileSettlement — clean case", () => {
  it("produces no exceptions when everything is internally consistent", () => {
    const payment = mkPayment({ amountPaise: 100000, capturedAt: new Date("2026-03-05T10:00:00Z") });
    const settlement = mkSettlement({ grossAmountPaise: 100000, feeAmountPaise: 2000, taxAmountPaise: 360 });

    const result = reconcileSettlement(settlement, [payment], new Map(), []);

    expect(result.exceptions).toHaveLength(0);
    expect(result.items).toHaveLength(1);
    expect(result.expectedNetPaise).toBe(100000 - 2000 - 360); // no refunds, no adjustments
  });
});

describe("reconcileSettlement — MISSING_SETTLEMENT", () => {
  it("detects a single orphaned payment", () => {
    const included = mkPayment({ amountPaise: 100000, capturedAt: new Date("2026-03-05T10:00:00Z") });
    const orphan = mkPayment({ amountPaise: 55000, capturedAt: new Date("2026-03-05T11:00:00Z") });
    // Settlement's reported gross only reflects `included`, not `orphan`.
    const settlement = mkSettlement({ grossAmountPaise: 100000, feeAmountPaise: 2000, taxAmountPaise: 360 });

    const result = reconcileSettlement(settlement, [included, orphan], new Map(), []);

    const missing = result.exceptions.filter((e) => e.type === "MISSING_SETTLEMENT");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.primaryRecordId).toBe(orphan.id);
    expect(missing[0]!.amountAtRiskPaise).toBe(55000);
    // The orphan must not silently inflate the confirmed gross used for
    // downstream fee checking — this is exactly the bug found at
    // benchmark scale: an unresolved orphan corrupts the gross, which
    // then trips a SPURIOUS FEE_MISMATCH on top of the missed detection.
    expect(result.exceptions.filter((e) => e.type === "FEE_MISMATCH")).toHaveLength(0);
  });

  it("REGRESSION: detects TWO orphaned payments in the same settlement, not just one", () => {
    // This is the exact scenario that broke the single-payment culprit
    // lookup at benchmark scale: two payments orphaned from the same
    // settlement by chance. A naive `find single payment == gap` lookup
    // fails here since no single payment equals the combined gap,
    // silently leaving both in the "confirmed" gross.
    const included = mkPayment({ amountPaise: 100000, capturedAt: new Date("2026-03-05T10:00:00Z") });
    const orphanA = mkPayment({ amountPaise: 30000, capturedAt: new Date("2026-03-05T11:00:00Z") });
    const orphanB = mkPayment({ amountPaise: 45000, capturedAt: new Date("2026-03-05T12:00:00Z") });
    const settlement = mkSettlement({ grossAmountPaise: 100000, feeAmountPaise: 2000, taxAmountPaise: 360 });

    const result = reconcileSettlement(settlement, [included, orphanA, orphanB], new Map(), []);

    const missing = result.exceptions.filter((e) => e.type === "MISSING_SETTLEMENT");
    expect(missing).toHaveLength(2);
    const flaggedIds = missing.map((m) => m.primaryRecordId).sort();
    expect(flaggedIds).toEqual([orphanA.id, orphanB.id].sort());
    // Confirmed gross must exclude BOTH orphans, not just one or neither.
    expect(result.items.filter((i) => i.itemType === "payment")).toHaveLength(1);
    expect(result.exceptions.filter((e) => e.type === "FEE_MISMATCH")).toHaveLength(0);
  });
});

describe("reconcileSettlement — FEE_MISMATCH", () => {
  it("detects a fee that doesn't match 2% of the confirmed gross", () => {
    const payment = mkPayment({ amountPaise: 100000, capturedAt: new Date("2026-03-05T10:00:00Z") });
    const settlement = mkSettlement({ grossAmountPaise: 100000, feeAmountPaise: 5000, taxAmountPaise: 900 }); // wrong: should be 2000/360

    const result = reconcileSettlement(settlement, [payment], new Map(), []);

    const feeMismatch = result.exceptions.filter((e) => e.type === "FEE_MISMATCH");
    expect(feeMismatch).toHaveLength(1);
    expect(feeMismatch[0]!.amountAtRiskPaise).toBe(Math.abs(2000 - 5000) + Math.abs(360 - 900));
  });
});

describe("reconcileSettlement — UNKNOWN_ADJUSTMENT", () => {
  it("flags an adjustment with no source_reference and excludes it from the expected total", () => {
    const payment = mkPayment({ amountPaise: 100000, capturedAt: new Date("2026-03-05T10:00:00Z") });
    const settlement = mkSettlement({ grossAmountPaise: 100000, feeAmountPaise: 2000, taxAmountPaise: 360, adjustmentAmountPaise: -50000 });
    const unexplained: AdjustmentRecord = {
      id: nextId(),
      batchId: 1,
      settlementId: settlement.id,
      externalAdjustmentId: "ADJ_1",
      amountPaise: -50000,
      type: "manual_adjustment",
      description: "manual adjustment",
      sourceReference: null,
      createdAt: new Date("2026-03-06T00:00:00Z"),
    };

    const result = reconcileSettlement(settlement, [payment], new Map(), [unexplained]);

    const unknownAdj = result.exceptions.filter((e) => e.type === "UNKNOWN_ADJUSTMENT");
    expect(unknownAdj).toHaveLength(1);
    expect(unknownAdj[0]!.amountAtRiskPaise).toBe(50000);
    // Unexplained adjustments are excluded from the expected-net
    // calculation — that's the whole point of flagging them.
    expect(result.expectedNetPaise).toBe(100000 - 2000 - 360);
  });

  it("does NOT flag an adjustment that has a source_reference, and includes it in the expected total", () => {
    const payment = mkPayment({ amountPaise: 100000, capturedAt: new Date("2026-03-05T10:00:00Z") });
    const settlement = mkSettlement({ grossAmountPaise: 100000, feeAmountPaise: 2000, taxAmountPaise: 360, adjustmentAmountPaise: -50000 });
    const explained: AdjustmentRecord = {
      id: nextId(),
      batchId: 1,
      settlementId: settlement.id,
      externalAdjustmentId: "ADJ_2",
      amountPaise: -50000,
      type: "chargeback_fee",
      description: "Chargeback fee for dispute DP-1234",
      sourceReference: "DP-1234",
      createdAt: new Date("2026-03-06T00:00:00Z"),
    };

    const result = reconcileSettlement(settlement, [payment], new Map(), [explained]);

    expect(result.exceptions.filter((e) => e.type === "UNKNOWN_ADJUSTMENT")).toHaveLength(0);
    expect(result.expectedNetPaise).toBe(100000 - 2000 - 360 - 50000);
  });
});

describe("reconcileSettlement — deduplicated refunds", () => {
  it("counts a duplicated refund only once toward the expected total", () => {
    const payment = mkPayment({ amountPaise: 100000, capturedAt: new Date("2026-03-05T10:00:00Z") });
    const settlement = mkSettlement({ grossAmountPaise: 100000, feeAmountPaise: 2000, taxAmountPaise: 360 });
    const createdAt = new Date("2026-03-05T10:05:00Z");
    const refundA: RefundRecord = { id: nextId(), batchId: 1, externalRefundId: "REF_1", paymentId: payment.id, amountPaise: 20000, status: "processed", createdAt, rawPayload: {} };
    const refundB: RefundRecord = { id: nextId(), batchId: 1, externalRefundId: "REF_2", paymentId: payment.id, amountPaise: 20000, status: "processed", createdAt, rawPayload: {} };

    const refundsByPaymentId = new Map([[payment.id, [refundA, refundB]]]);
    const result = reconcileSettlement(settlement, [payment], refundsByPaymentId, []);

    // Expected net should deduct the refund ONCE (₹200), not twice —
    // the duplicate itself is flagged separately by detectDuplicateRefunds,
    // not by this function.
    expect(result.expectedNetPaise).toBe(100000 - 20000 - 2000 - 360);
  });
});
