/**
 * SettleGuard settlement grouping and bank-credit generation.
 *
 * Pass 1 only: this produces the CORRECT version of every settlement
 * and bank transaction — internally consistent, zero errors. The
 * exceptions module runs afterward and deliberately breaks specific
 * pieces of this using a deterministic two-pass approach,
 * just extended to many settlements instead of one.
 *
 * Settlements are grouped by calendar day, not by a fixed record
 * count — one settlement per day that has ≥1 captured payment, which
 * is how real T+1 settlement cycles actually work.
 */

import type { BankTransaction, Payment, Refund, Settlement } from "./types.js";
import { addDays, atTime, calculateFeePaise, calculateTaxPaise, dayBucket } from "./utils.js";

export interface SettlementGrouping {
  settlements: Settlement[];
  settlementPayments: Map<string, string[]>; // settlementId -> paymentIds included
  paymentToSettlement: Map<string, string>; // only for payments that ARE included
}

export function groupIntoSettlements(payments: Payment[], refunds: Refund[]): SettlementGrouping {
  const refundByPayment = new Map<string, number>();
  for (const r of refunds) {
    refundByPayment.set(r.paymentId, (refundByPayment.get(r.paymentId) ?? 0) + r.amountPaise);
  }

  const byDay = new Map<string, Payment[]>();
  for (const p of payments) {
    const day = p.capturedAt.slice(0, 10);
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }

  const settlements: Settlement[] = [];
  const settlementPayments = new Map<string, string[]>();
  const paymentToSettlement = new Map<string, string>();

  const days = [...byDay.keys()].sort();
  for (const day of days) {
    const dayPayments = byDay.get(day)!;
    const grossPaise = dayPayments.reduce((s, p) => s + p.amountPaise, 0);
    const refundTotalPaise = dayPayments.reduce((s, p) => s + (refundByPayment.get(p.id) ?? 0), 0);
    const feePaise = calculateFeePaise(grossPaise);
    const taxPaise = calculateTaxPaise(feePaise);
    const netPaise = grossPaise - refundTotalPaise - feePaise - taxPaise;

    const settledDay = dayBucket(addDays(day, 1));
    const settlementId = `SET_${day.replace(/-/g, "")}`;

    settlements.push({
      id: settlementId,
      dayBucket: day,
      grossAmountPaise: grossPaise,
      feeAmountPaise: feePaise,
      taxAmountPaise: taxPaise,
      adjustmentAmountPaise: 0,
      reportedNetPaise: netPaise,
      settledAt: atTime(settledDay, 18, 0),
      bankReference: `UTR${day.replace(/-/g, "")}${String(dayPayments.length).padStart(3, "0")}`,
    });

    const ids = dayPayments.map((p) => p.id);
    settlementPayments.set(settlementId, ids);
    for (const id of ids) paymentToSettlement.set(id, settlementId);
  }

  return { settlements, settlementPayments, paymentToSettlement };
}

export function generateBankTransactions(settlements: Settlement[]): BankTransaction[] {
  return settlements.map((s) => {
    const creditDay = dayBucket(addDays(s.dayBucket, 2));
    return {
      id: `BANK_${s.dayBucket.replace(/-/g, "")}`,
      settlementId: s.id,
      amountPaise: s.reportedNetPaise,
      direction: "credit",
      postedAt: atTime(creditDay, 9, 0),
      reference: s.bankReference,
      description: "NEFT settlement credit",
    };
  });
}
