/**
 * Duplicate-refund detection over ingested records, independent of settlement
 * matching.
 */

import type { RefundRecord } from "../db/schema.js";

export interface DuplicateRefundException {
  type: "DUPLICATE_REFUND";
  amountAtRiskPaise: number;
  primaryRecordType: "refund";
  primaryRecordId: number;
  summary: string;
  evidence: Record<string, unknown>;
}

export function detectDuplicateRefunds(refunds: RefundRecord[]): DuplicateRefundException[] {
  const groups = new Map<string, RefundRecord[]>();
  for (const r of refunds) {
    if (r.paymentId === null) continue; // nothing to compare a duplicate against
    const key = `${r.paymentId}|${r.amountPaise}|${r.createdAt.toISOString()}`;
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }

  const exceptions: DuplicateRefundException[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const [original, ...dupes] = group;
    for (const dupe of dupes) {
      exceptions.push({
        type: "DUPLICATE_REFUND",
        amountAtRiskPaise: dupe.amountPaise,
        primaryRecordType: "refund",
        primaryRecordId: dupe.id,
        summary: `Refunds ${original!.externalRefundId} and ${dupe.externalRefundId} share the same payment, amount, and timestamp — likely one refund recorded twice.`,
        evidence: { originalRefundId: original!.id, duplicateRefundId: dupe.id, paymentId: dupe.paymentId, amountPaise: dupe.amountPaise },
      });
    }
  }
  return exceptions;
}
