/**
 * SettleGuard per-settlement reconciliation.
 *
 * Settlements carry no payment-level breakdown in the raw data — a
 * real settlement report doesn't itemize every payment either, so
 * which payments belong to which settlement has to be DERIVED, not
 * read off a foreign key. This infers it from the settlement's own
 * cycle (settledAt implies which capture day it covers), which is
 * a date-window derivation. There is no exact ID to match on here,
 * so there's no Stage A for this particular link.
 *
 * Once payments are confirmed, fee/tax are independently recomputed
 * from that confirmed gross — the settlement file's own reported fee
 * is never trusted, only checked against.
 */

import type { AdjustmentRecord, PaymentRecord, RefundRecord, SettlementRecord } from "../db/schema.js";
import { addDaysIso, calculateFeePaise, calculateTaxPaise, dateOnly, inr } from "./money.js";

// A T+1 settlement cycle is this system's known convention (see Day
// 2's generator). A real multi-merchant system would need this
// configurable per merchant rather than a single constant — called
// out here rather than buried as a magic number.
const SETTLEMENT_CYCLE_DAYS = 1;

// A settlement losing more than a couple of payments to the same
// injected error is very unlikely at any realistic scale — bounding
// the search keeps it cheap (checked up to size 3: O(n^3) on a
// per-settlement payment count, not the whole batch) rather than an
// unbounded subset-sum search.
const MAX_MISSING_PAYMENTS_PER_SETTLEMENT = 3;

/** Finds a small combination of payments whose amounts sum exactly to `target`, checking size 1 first, then 2, then 3. Empty array if none found within that bound. */
function findPaymentsSummingTo(candidates: PaymentRecord[], target: number): PaymentRecord[] {
  if (target <= 0) return [];
  for (let size = 1; size <= Math.min(MAX_MISSING_PAYMENTS_PER_SETTLEMENT, candidates.length); size++) {
    const combo = findCombinationOfSize(candidates, size, target);
    if (combo) return combo;
  }
  return [];
}

function findCombinationOfSize(items: PaymentRecord[], size: number, target: number): PaymentRecord[] | null {
  const chosen: PaymentRecord[] = [];
  function search(start: number, remaining: number, remainingTarget: number): PaymentRecord[] | null {
    if (remaining === 0) return remainingTarget === 0 ? [...chosen] : null;
    for (let i = start; i <= items.length - remaining; i++) {
      const item = items[i]!;
      if (item.amountPaise > remainingTarget) continue;
      chosen.push(item);
      const found = search(i + 1, remaining - 1, remainingTarget - item.amountPaise);
      if (found) return found;
      chosen.pop();
    }
    return null;
  }
  return search(0, size, target);
}

export interface SettlementItemLink {
  settlementId: number;
  paymentId: number | null;
  refundId: number | null;
  itemType: "payment" | "refund";
  amountPaise: number;
}

export interface DetectedException {
  type: "MISSING_SETTLEMENT" | "FEE_MISMATCH" | "UNKNOWN_ADJUSTMENT";
  amountAtRiskPaise: number;
  primaryRecordType: string;
  primaryRecordId: number;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface SettlementReconciliationResult {
  settlementId: number;
  expectedNetPaise: number;
  items: SettlementItemLink[];
  exceptions: DetectedException[];
  matchedPaymentCount: number;
  excludedPaymentIds: number[];
}

export function reconcileSettlement(
  settlement: SettlementRecord,
  allPayments: PaymentRecord[],
  refundsByPaymentId: Map<number, RefundRecord[]>,
  adjustmentsForSettlement: AdjustmentRecord[],
): SettlementReconciliationResult {
  const exceptions: DetectedException[] = [];
  const items: SettlementItemLink[] = [];

  // ---- 1. Infer which payments belong here, by date ----
  const captureDayIso = settlement.settledAt ? addDaysIso(dateOnly(settlement.settledAt), -SETTLEMENT_CYCLE_DAYS) : null;
  const candidatePayments = captureDayIso ? allPayments.filter((p) => dateOnly(p.capturedAt) === captureDayIso) : [];
  const candidateGrossPaise = candidatePayments.reduce((s, p) => s + p.amountPaise, 0);

  let matchedPayments = candidatePayments;
  const excludedPaymentIds: number[] = [];

  if (candidateGrossPaise !== settlement.grossAmountPaise) {
    const gapPaise = candidateGrossPaise - settlement.grossAmountPaise;
    const culprits = findPaymentsSummingTo(candidatePayments, gapPaise);
    if (culprits.length > 0) {
      const culpritIds = new Set(culprits.map((p) => p.id));
      matchedPayments = candidatePayments.filter((p) => !culpritIds.has(p.id));
      for (const culprit of culprits) {
        excludedPaymentIds.push(culprit.id);
        exceptions.push({
          type: "MISSING_SETTLEMENT",
          amountAtRiskPaise: culprit.amountPaise,
          primaryRecordType: "payment",
          primaryRecordId: culprit.id,
          summary: `Payment ${culprit.externalPaymentId} (${inr(culprit.amountPaise)}) was captured on ${captureDayIso} but is not included in settlement ${settlement.externalSettlementId}'s reported gross.`,
          evidence: {
            paymentId: culprit.id,
            externalPaymentId: culprit.externalPaymentId,
            expectedSettlementId: settlement.id,
            candidateGrossPaise,
            reportedGrossPaise: settlement.grossAmountPaise,
          },
        });
      }
    }
    // Else: the gap doesn't resolve to any combination up to
    // MAX_MISSING_PAYMENTS_PER_SETTLEMENT payments. Not exercised by
    // today's injected data — left as a known limit rather than
    // silently guessed at with an unbounded subset search.
  }

  const confirmedGrossPaise = matchedPayments.reduce((s, p) => s + p.amountPaise, 0);

  for (const p of matchedPayments) {
    items.push({ settlementId: settlement.id, paymentId: p.id, refundId: null, itemType: "payment", amountPaise: p.amountPaise });
  }

  // ---- 2. Refunds for matched payments, deduplicated ----
  const seenRefundKeys = new Set<string>();
  let dedupedRefundTotalPaise = 0;
  for (const p of matchedPayments) {
    for (const r of refundsByPaymentId.get(p.id) ?? []) {
      const key = `${r.paymentId}|${r.amountPaise}|${r.createdAt.toISOString()}`;
      if (seenRefundKeys.has(key)) continue;
      seenRefundKeys.add(key);
      dedupedRefundTotalPaise += r.amountPaise;
      items.push({ settlementId: settlement.id, paymentId: null, refundId: r.id, itemType: "refund", amountPaise: r.amountPaise });
    }
  }

  // ---- 3. Fee/tax: independently recomputed from the CONFIRMED gross ----
  const correctFeePaise = calculateFeePaise(confirmedGrossPaise);
  const correctTaxPaise = calculateTaxPaise(correctFeePaise);
  if (correctFeePaise !== settlement.feeAmountPaise) {
    const feeDelta = Math.abs(correctFeePaise - settlement.feeAmountPaise);
    const taxDelta = Math.abs(correctTaxPaise - settlement.taxAmountPaise);
    exceptions.push({
      type: "FEE_MISMATCH",
      amountAtRiskPaise: feeDelta + taxDelta,
      primaryRecordType: "settlement",
      primaryRecordId: settlement.id,
      summary: `Settlement ${settlement.externalSettlementId} reports a fee of ${inr(settlement.feeAmountPaise)}; 2% of the confirmed gross calculates to ${inr(correctFeePaise)}.`,
      evidence: {
        settlementId: settlement.id,
        correctFeePaise,
        reportedFeePaise: settlement.feeAmountPaise,
        correctTaxPaise,
        reportedTaxPaise: settlement.taxAmountPaise,
      },
    });
  }

  // ---- 4. Adjustments: flag any without a source_reference ----
  let explainedAdjustmentTotalPaise = 0;
  for (const adj of adjustmentsForSettlement) {
    if (adj.sourceReference === null) {
      exceptions.push({
        type: "UNKNOWN_ADJUSTMENT",
        amountAtRiskPaise: Math.abs(adj.amountPaise),
        primaryRecordType: "adjustment",
        primaryRecordId: adj.id,
        summary: `Adjustment ${adj.externalAdjustmentId ?? adj.id} (${inr(adj.amountPaise)}) on settlement ${settlement.externalSettlementId} has no source_reference.`,
        evidence: { settlementId: settlement.id, adjustmentId: adj.id, amountPaise: adj.amountPaise },
      });
    } else {
      explainedAdjustmentTotalPaise += adj.amountPaise;
    }
  }

  // ---- 5. Expected settlement — plain arithmetic, never delegated ----
  const expectedNetPaise = confirmedGrossPaise - dedupedRefundTotalPaise - correctFeePaise - correctTaxPaise + explainedAdjustmentTotalPaise;

  return {
    settlementId: settlement.id,
    expectedNetPaise,
    items,
    exceptions,
    matchedPaymentCount: matchedPayments.length,
    excludedPaymentIds,
  };
}
