import { describe, expect, it } from "vitest";
import { detectDuplicateRefunds } from "../src/reconciliation/duplicate-refunds.js";
import type { RefundRecord } from "../src/db/schema.js";

let idSeq = 1;
const nextId = () => idSeq++;

function mkRefund(overrides: Partial<RefundRecord> = {}): RefundRecord {
  return {
    id: nextId(),
    batchId: 1,
    externalRefundId: `REF_${nextId()}`,
    paymentId: 1,
    amountPaise: 20000,
    status: "processed",
    createdAt: new Date("2026-03-05T10:05:00Z"),
    rawPayload: {},
    ...overrides,
  };
}

describe("detectDuplicateRefunds", () => {
  it("finds no duplicates among genuinely distinct refunds", () => {
    const refunds = [
      mkRefund({ paymentId: 1, amountPaise: 20000 }),
      mkRefund({ paymentId: 2, amountPaise: 20000 }), // same amount, different payment — not a duplicate
      mkRefund({ paymentId: 1, amountPaise: 30000 }), // same payment, different amount — not a duplicate
    ];
    expect(detectDuplicateRefunds(refunds)).toHaveLength(0);
  });

  it("flags an exact duplicate (same payment, amount, and timestamp)", () => {
    const createdAt = new Date("2026-03-05T10:05:00Z");
    const original = mkRefund({ paymentId: 1, amountPaise: 20000, createdAt });
    const duplicate = mkRefund({ paymentId: 1, amountPaise: 20000, createdAt });

    const result = detectDuplicateRefunds([original, duplicate]);

    expect(result).toHaveLength(1);
    expect(result[0]!.primaryRecordId).toBe(duplicate.id);
    expect(result[0]!.amountAtRiskPaise).toBe(20000);
  });

  it("flags every extra copy when a refund is tripled, not just one", () => {
    const createdAt = new Date("2026-03-05T10:05:00Z");
    const refunds = [
      mkRefund({ paymentId: 1, amountPaise: 20000, createdAt }),
      mkRefund({ paymentId: 1, amountPaise: 20000, createdAt }),
      mkRefund({ paymentId: 1, amountPaise: 20000, createdAt }),
    ];
    expect(detectDuplicateRefunds(refunds)).toHaveLength(2); // 2 extras beyond the original
  });

  it("ignores refunds with no linked payment — nothing to compare them against", () => {
    const refunds = [mkRefund({ paymentId: null }), mkRefund({ paymentId: null })];
    expect(detectDuplicateRefunds(refunds)).toHaveLength(0);
  });
});
