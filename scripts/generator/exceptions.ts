/**
 * SettleGuard — Phase 1, Step 2: the exception injector.
 *
 * Pass 2: takes the correct Pass 1 dataset and deliberately breaks
 * exactly `config.exceptions.*` records per type, recording precisely
 * what was changed in `groundTruth` so Phase 3's benchmark has an
 * answer key to score against. Order matters — see generate-dataset.ts
 * for why each step runs when it does.
 */

import type {
  Adjustment,
  BankTransaction,
  DatasetConfig,
  ExceptionCounts,
  GroundTruthEntry,
  Payment,
  Refund,
  Settlement,
} from "./types.js";
import { calculateFeePaise, calculateTaxPaise, inr } from "./utils.js";
import type { SettlementGrouping } from "./settlements.js";

function pick<T>(pool: T[], count: number, rand: () => number): T[] {
  const copy = [...pool];
  const chosen: T[] = [];
  const n = Math.min(count, copy.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rand() * copy.length);
    chosen.push(copy.splice(idx, 1)[0]!);
  }
  // If more were requested than the pool holds, allow reuse for the remainder
  // rather than silently under-injecting — flagged in the summary report.
  while (chosen.length < count && pool.length > 0) {
    chosen.push(pool[Math.floor(rand() * pool.length)]!);
  }
  return chosen;
}

function refundTotalForPayments(paymentIds: string[], refundByPayment: Map<string, number>): number {
  return paymentIds.reduce((s, id) => s + (refundByPayment.get(id) ?? 0), 0);
}

// ---------------- 1. MISSING_SETTLEMENT ----------------
// Orphan N captured payments: remove them from their settlement's
// payment list and recompute that settlement's correct baseline
// (gross/fee/tax) for its smaller, now-accurate payment set.
export function injectMissingSettlement(
  grouping: SettlementGrouping,
  payments: Payment[],
  refunds: Refund[],
  settlements: Settlement[],
  count: number,
  rand: () => number,
): GroundTruthEntry[] {
  const refundByPayment = new Map<string, number>();
  for (const r of refunds) refundByPayment.set(r.paymentId, (refundByPayment.get(r.paymentId) ?? 0) + r.amountPaise);

  // Only orphan payments whose settlement currently has >1 payment,
  // so no settlement is left with zero payments.
  const eligible = payments.filter((p) => (grouping.settlementPayments.get(grouping.paymentToSettlement.get(p.id)!)?.length ?? 0) > 1);
  const chosen = pick(eligible, count, rand);
  const entries: GroundTruthEntry[] = [];
  const touchedSettlements = new Set<string>();

  for (const p of chosen) {
    const settlementId = grouping.paymentToSettlement.get(p.id);
    if (!settlementId) continue; // already orphaned by an earlier pick
    const list = grouping.settlementPayments.get(settlementId)!;
    const next = list.filter((id) => id !== p.id);
    grouping.settlementPayments.set(settlementId, next);
    grouping.paymentToSettlement.delete(p.id);
    touchedSettlements.add(settlementId);

    entries.push({
      type: "MISSING_SETTLEMENT",
      recordIds: [p.id, settlementId],
      amountAtRiskPaise: p.amountPaise,
      detail: { paymentId: p.id, expectedSettlementId: settlementId, amountPaise: p.amountPaise },
      note: `Payment ${p.id} (${inr(p.amountPaise)}) was captured but never included in settlement ${settlementId} — it has no settlement to reconcile against.`,
    });
  }

  // Recompute the correct (pre-feeMismatch) baseline for every settlement
  // whose payment membership changed.
  for (const s of settlements) {
    if (!touchedSettlements.has(s.id)) continue;
    const ids = grouping.settlementPayments.get(s.id) ?? [];
    const gross = ids.reduce((sum, id) => sum + payments.find((p) => p.id === id)!.amountPaise, 0);
    const fee = calculateFeePaise(gross);
    s.grossAmountPaise = gross;
    s.feeAmountPaise = fee;
    s.taxAmountPaise = calculateTaxPaise(fee);
  }

  return entries;
}

// ---------------- 2. FEE_MISMATCH ----------------
export function injectFeeMismatch(settlements: Settlement[], used: Set<string>, count: number, rand: () => number): GroundTruthEntry[] {
  const pool = settlements.filter((s) => !used.has(s.id));
  const chosen = pick(pool.length >= count ? pool : settlements, count, rand);
  const entries: GroundTruthEntry[] = [];

  for (const s of chosen) {
    used.add(s.id);
    const correctFee = calculateFeePaise(s.grossAmountPaise);
    const deltaPaise = (rand() < 0.5 ? -1 : 1) * Math.round(10000 + rand() * 140000); // ±₹100–₹1,500
    const reportedFee = correctFee + deltaPaise;
    s.feeAmountPaise = reportedFee;
    s.taxAmountPaise = calculateTaxPaise(reportedFee);

    entries.push({
      type: "FEE_MISMATCH",
      recordIds: [s.id],
      amountAtRiskPaise: Math.abs(deltaPaise),
      detail: { settlementId: s.id, correctFeePaise: correctFee, reportedFeePaise: reportedFee, deltaPaise },
      note: `Settlement ${s.id} reports a fee of ${inr(reportedFee)}; 2% of gross calculates to ${inr(correctFee)}.`,
    });
  }
  return entries;
}

// ---------------- 3. UNKNOWN_ADJUSTMENT ----------------
export function injectUnknownAdjustment(
  settlements: Settlement[],
  used: Set<string>,
  count: number,
  rand: () => number,
): { entries: GroundTruthEntry[]; adjustments: Adjustment[] } {
  const pool = settlements.filter((s) => !used.has(s.id));
  const chosen = pick(pool.length >= count ? pool : settlements, count, rand);
  const entries: GroundTruthEntry[] = [];
  const adjustments: Adjustment[] = [];
  let seq = 1;

  for (const s of chosen) {
    used.add(s.id);
    const amountPaise = -Math.round(50000 + rand() * 750000); // -₹500 to -₹8,000
    const adj: Adjustment = {
      id: `ADJ_${s.dayBucket.replace(/-/g, "")}_${seq++}`,
      settlementId: s.id,
      amountPaise,
      type: "manual_adjustment",
      description: "manual adjustment",
      sourceReference: null,
    };
    adjustments.push(adj);
    s.adjustmentAmountPaise += amountPaise;

    entries.push({
      type: "UNKNOWN_ADJUSTMENT",
      recordIds: [s.id, adj.id],
      amountAtRiskPaise: Math.abs(amountPaise),
      detail: { settlementId: s.id, adjustmentId: adj.id, amountPaise },
      note: `Adjustment ${adj.id} (${inr(amountPaise)}) on settlement ${s.id} has no source_reference.`,
    });
  }
  return { entries, adjustments };
}

// ---------------- Finalize nets (run after all money-affecting injectors) ----------------
export function finalizeSettlementNets(settlements: Settlement[], grouping: SettlementGrouping, refunds: Refund[]): void {
  const refundByPayment = new Map<string, number>();
  for (const r of refunds) refundByPayment.set(r.paymentId, (refundByPayment.get(r.paymentId) ?? 0) + r.amountPaise);

  for (const s of settlements) {
    const ids = grouping.settlementPayments.get(s.id) ?? [];
    const refundTotal = refundTotalForPayments(ids, refundByPayment);
    s.reportedNetPaise = s.grossAmountPaise - refundTotal - s.feeAmountPaise - s.taxAmountPaise + s.adjustmentAmountPaise;
  }
}

// ---------------- 4. BANK_CREDIT_MISMATCH ----------------
export function injectBankAmountMismatch(bankTransactions: BankTransaction[], used: Set<string>, count: number, rand: () => number): GroundTruthEntry[] {
  const pool = bankTransactions.filter((b) => !used.has(b.settlementId));
  const chosen = pick(pool.length >= count ? pool : bankTransactions, count, rand);
  const entries: GroundTruthEntry[] = [];

  for (const b of chosen) {
    used.add(b.settlementId);
    const deltaPaise = (rand() < 0.5 ? -1 : 1) * Math.round(10000 + rand() * 140000); // ±₹100–₹1,500
    const expected = b.amountPaise;
    b.amountPaise = expected + deltaPaise;

    entries.push({
      type: "BANK_CREDIT_MISMATCH",
      recordIds: [b.settlementId, b.id],
      amountAtRiskPaise: Math.abs(deltaPaise),
      detail: { settlementId: b.settlementId, bankTransactionId: b.id, expectedPaise: expected, actualPaise: b.amountPaise, deltaPaise },
      note: `Bank credit ${b.id} posted ${inr(b.amountPaise)}; settlement ${b.settlementId} expected ${inr(expected)}.`,
    });
  }
  return entries;
}

// ---------------- 5. AMBIGUOUS_MATCH ----------------
// Garble the bank transaction's reference so Stage A exact-reference
// matching fails and a future matcher must fall back to amount + date
// (Stage B/C) instead.
export function injectAmbiguousReference(bankTransactions: BankTransaction[], used: Set<string>, count: number, rand: () => number): GroundTruthEntry[] {
  const pool = bankTransactions.filter((b) => !used.has(b.settlementId));
  const chosen = pick(pool.length >= count ? pool : bankTransactions, count, rand);
  const entries: GroundTruthEntry[] = [];

  for (const b of chosen) {
    used.add(b.settlementId);
    const original = b.reference;
    const garbled = `NEFT-BATCH-${Math.floor(rand() * 900000 + 100000)}`;
    b.reference = garbled;

    entries.push({
      type: "AMBIGUOUS_MATCH",
      recordIds: [b.settlementId, b.id],
      amountAtRiskPaise: b.amountPaise,
      detail: { settlementId: b.settlementId, bankTransactionId: b.id, originalReference: original, corruptedReference: garbled },
      note: `Bank credit ${b.id}'s reference no longer matches settlement ${b.settlementId}'s bankReference (${original} → ${garbled}); must be resolved via amount + date, not an exact reference match.`,
    });
  }
  return entries;
}

// ---------------- 6. DUPLICATE_REFUND ----------------
export function injectDuplicateRefund(refunds: Refund[], count: number, rand: () => number): GroundTruthEntry[] {
  const chosen = pick(refunds, count, rand);
  const entries: GroundTruthEntry[] = [];
  let seq = refunds.length + 1;

  for (const r of chosen) {
    const dup: Refund = { ...r, id: `REF_${90000 + seq}` };
    seq++;
    refunds.push(dup);
    entries.push({
      type: "DUPLICATE_REFUND",
      recordIds: [r.id, dup.id],
      amountAtRiskPaise: r.amountPaise,
      detail: { originalRefundId: r.id, duplicateRefundId: dup.id, paymentId: r.paymentId, amountPaise: r.amountPaise },
      note: `Refunds ${r.id} and ${dup.id} share the same payment, amount, and timestamp — likely one refund recorded twice.`,
    });
  }
  return entries;
}

export interface InjectionResult {
  groundTruth: GroundTruthEntry[];
  adjustments: Adjustment[];
}

/** Runs all six injectors in the order that keeps the money math consistent. */
export function injectAllExceptions(
  grouping: SettlementGrouping,
  payments: Payment[],
  refunds: Refund[],
  settlements: Settlement[],
  counts: ExceptionCounts,
  rand: () => number,
): InjectionResult {
  const groundTruth: GroundTruthEntry[] = [];
  const usedForFeeAdj = new Set<string>();

  const missingEntries = injectMissingSettlement(grouping, payments, refunds, settlements, counts.missingSettlement, rand);
  groundTruth.push(...missingEntries);
  // Prefer settlements NOT already touched by missingSettlement, so at
  // small scale each settlement demonstrates one distinct issue where
  // the pool allows it — purely for a cleaner hand-verification story;
  // at real scale, pools are large enough this rarely binds anyway.
  for (const e of missingEntries) usedForFeeAdj.add(e.recordIds[1]!);

  groundTruth.push(...injectFeeMismatch(settlements, usedForFeeAdj, counts.feeMismatch, rand));
  const unknownAdj = injectUnknownAdjustment(settlements, usedForFeeAdj, counts.unknownAdjustment, rand);
  groundTruth.push(...unknownAdj.entries);

  finalizeSettlementNets(settlements, grouping, refunds);
  // Bank transactions are generated by the caller AFTER this point, from the
  // now-finalized settlements — see generate-dataset.ts.

  groundTruth.push(...injectDuplicateRefund(refunds, counts.duplicateRefund, rand));

  return { groundTruth, adjustments: unknownAdj.adjustments };
}

/** Second stage, run by the caller once bank transactions exist. */
export function injectBankStageExceptions(
  bankTransactions: BankTransaction[],
  counts: Pick<ExceptionCounts, "bankAmountMismatch" | "ambiguousReference">,
  rand: () => number,
): GroundTruthEntry[] {
  const usedForBank = new Set<string>();
  return [
    ...injectBankAmountMismatch(bankTransactions, usedForBank, counts.bankAmountMismatch, rand),
    ...injectAmbiguousReference(bankTransactions, usedForBank, counts.ambiguousReference, rand),
  ];
}
