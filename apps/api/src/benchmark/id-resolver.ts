/**
 * External-to-internal benchmark ID resolution.
 *
 * ground_truth.json speaks in external IDs ("PAY_10034", "SET_20260301")
 * because the generator writes them to the CSVs. Detected exceptions
 * use internal database IDs assigned during ingestion. This bridge is built once
 * per batch from a handful of
 * cheap queries rather than re-resolved per ground-truth entry.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { adjustments, bankTransactions, payments, refunds, settlements } from "../db/schema.js";

export interface IdMaps {
  paymentExternalToInternal: Map<string, number>;
  refundExternalToInternal: Map<string, number>;
  settlementExternalToInternal: Map<string, number>;
  bankExternalToInternal: Map<string, number>;
  adjustmentExternalToInternal: Map<string, number>;
}

export async function buildIdMaps(batchId: number): Promise<IdMaps> {
  const [pmts, rfnds, stls, bnks, adjs] = await Promise.all([
    db.select({ id: payments.id, externalId: payments.externalPaymentId }).from(payments).where(eq(payments.batchId, batchId)),
    db.select({ id: refunds.id, externalId: refunds.externalRefundId }).from(refunds).where(eq(refunds.batchId, batchId)),
    db.select({ id: settlements.id, externalId: settlements.externalSettlementId }).from(settlements).where(eq(settlements.batchId, batchId)),
    db.select({ id: bankTransactions.id, externalId: bankTransactions.externalBankId }).from(bankTransactions).where(eq(bankTransactions.batchId, batchId)),
    db.select({ id: adjustments.id, externalId: adjustments.externalAdjustmentId }).from(adjustments).where(eq(adjustments.batchId, batchId)),
  ]);

  return {
    paymentExternalToInternal: new Map(pmts.map((p) => [p.externalId, p.id])),
    refundExternalToInternal: new Map(rfnds.map((r) => [r.externalId, r.id])),
    settlementExternalToInternal: new Map(stls.map((s) => [s.externalId, s.id])),
    bankExternalToInternal: new Map(bnks.map((b) => [b.externalId, b.id])),
    adjustmentExternalToInternal: new Map(adjs.filter((a) => a.externalId !== null).map((a) => [a.externalId as string, a.id])),
  };
}
