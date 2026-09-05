/**
 * SettleGuard payment and refund generation.
 * Refund generator supports partial / full / none per payment, as
 * the dataset configuration specifies.
 */

import type { DatasetConfig, Payment, PaymentMethod, Refund } from "./types.js";
import { addDays, atTime, dayBucket } from "./utils.js";

const METHODS: PaymentMethod[] = ["card", "upi", "netbanking", "wallet"];

function randomAmountPaise(rand: () => number): number {
  // Between ₹150.00 and ₹9,500.00.
  return Math.floor(rand() * (950000 - 15000) + 15000);
}

export function generatePayments(config: DatasetConfig, rand: () => number): Payment[] {
  const payments: Payment[] = [];
  const idBase = 10000;
  for (let i = 1; i <= config.paymentCount; i++) {
    const dayOffset = Math.floor(rand() * config.daySpan);
    const day = dayBucket(addDays(config.baseDate, dayOffset));
    const hh = 6 + Math.floor(rand() * 16); // captured 06:00–22:00
    const mm = Math.floor(rand() * 60);
    const idNum = idBase + i;
    payments.push({
      id: `PAY_${idNum}`,
      orderId: `ORDER_${idNum}`,
      amountPaise: randomAmountPaise(rand),
      currency: "INR",
      status: "captured",
      capturedAt: atTime(day, hh, mm),
      method: METHODS[Math.floor(rand() * METHODS.length)]!,
      merchantReference: `MREF_${idNum}`,
    });
  }
  return payments;
}

/**
 * ~refundRate of payments get a refund: half of those are full refunds,
 * half are partial (30%–70% of the payment amount). The rest get none.
 */
export function generateRefunds(payments: Payment[], config: DatasetConfig, rand: () => number): Refund[] {
  const refunds: Refund[] = [];
  const idBase = 50000;
  let seq = 1;
  for (const p of payments) {
    if (rand() < config.refundRate) {
      const isFull = rand() < 0.5;
      const amountPaise = isFull ? p.amountPaise : Math.round(p.amountPaise * (0.3 + rand() * 0.4));
      refunds.push({
        id: `REF_${idBase + seq}`,
        paymentId: p.id,
        amountPaise,
        status: "processed",
        createdAt: p.capturedAt,
      });
      seq++;
    }
  }
  return refunds;
}
