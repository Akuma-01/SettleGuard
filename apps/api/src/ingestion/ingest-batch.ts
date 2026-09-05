/**
 * Ingest and normalize a complete SettleGuard dataset folder.
 *
 * One dataset directory (payments.csv, refunds.csv, settlements.csv,
 * bank_transactions.csv, adjustments.csv) becomes one `batches` row
 * plus its child records. Order matters: payments and settlements are
 * inserted first so refunds/adjustments can resolve their external ID
 * references (payment_id, settlement_id) to real internal DB ids.
 */

import { and, eq } from "drizzle-orm";
import path from "node:path";
import { db } from "../db/client.js";
import { adjustments, bankTransactions, batches, merchants, payments, refunds, settlements } from "../db/schema.js";
import { emptyToNull, normalizeStatus, normalizeTimestamp, rupeeStringToPaise } from "./normalize.js";
import { parseAndValidateCsv, type RowError } from "./parse-csv.js";
import { adjustmentRowSchema, bankTransactionRowSchema, paymentRowSchema, refundRowSchema, settlementRowSchema } from "./schemas.js";

export interface IngestSummary {
  batchId: number;
  counts: Record<"payments" | "refunds" | "settlements" | "bankTransactions" | "adjustments", number>;
  errors: Record<"payments" | "refunds" | "settlements" | "bankTransactions" | "adjustments", RowError[]>;
  unresolvedRefundLinks: string[]; // refund rows whose payment_id didn't match any ingested payment
  unresolvedAdjustmentLinks: string[]; // adjustment rows whose settlement_id didn't match any ingested settlement
}

async function getOrCreateDefaultMerchant(): Promise<number> {
  const existing = await db.select().from(merchants).limit(1);
  if (existing.length > 0) return existing[0]!.id;
  const [created] = await db.insert(merchants).values({ name: "Demo Merchant" }).returning();
  return created!.id;
}


export async function ingestDataset(
  datasetDir: string,
  batchName: string,
): Promise<IngestSummary> {
  const merchantId = await getOrCreateDefaultMerchant();

  // Fast-path check for a friendly error.
  // The database UNIQUE constraint below is still the real guarantee
  // against concurrent duplicate requests.
  const existingBatch = await db
    .select({ id: batches.id })
    .from(batches)
    .where(
      and(
        eq(batches.merchantId, merchantId),
        eq(batches.name, batchName),
      ),
    )
    .limit(1);

  if (existingBatch.length > 0) {
    throw new Error(
      `Batch "${batchName}" already exists for merchant ${merchantId} ` +
      `(batch id ${existingBatch[0]!.id}).`,
    );
  }

  return db.transaction(async (tx) => {
    let batchId: number;

    try {
      const [batch] = await tx
        .insert(batches)
        .values({
          merchantId,
          name: batchName,
          status: "processing",
          startedAt: new Date(),
        })
        .returning();

      batchId = batch!.id;
    } catch (error) {
      // The UNIQUE constraint handles the race where another request
      // creates the same merchant/batch between our check and insert.
      if (
        error instanceof Error &&
        error.message.includes("batches_merchant_name_unique")
      ) {
        throw new Error(
          `Batch "${batchName}" already exists for merchant ${merchantId}.`,
        );
      }

      throw error;
    }

    // ---- payments ----
    const paymentsResult = parseAndValidateCsv(
      path.join(datasetDir, "payments.csv"),
      paymentRowSchema,
    );

    const paymentExternalToInternal = new Map<string, number>();

    if (paymentsResult.valid.length > 0) {
      const rows = paymentsResult.valid.map((r) => ({
        batchId,
        externalPaymentId: r.payment_id,
        orderId: r.order_id,
        amountPaise: rupeeStringToPaise(r.amount),
        currency: r.currency,
        status: normalizeStatus(r.status),
        capturedAt: normalizeTimestamp(r.captured_at),
        method: r.method,
        merchantReference: r.merchant_reference,
        rawPayload: r,
      }));

      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);

        const inserted = await tx
          .insert(payments)
          .values(chunk)
          .returning({
            id: payments.id,
            externalPaymentId: payments.externalPaymentId,
          });

        for (const row of inserted) {
          paymentExternalToInternal.set(
            row.externalPaymentId,
            row.id,
          );
        }
      }
    }

    // ---- settlements ----
    const settlementsResult = parseAndValidateCsv(
      path.join(datasetDir, "settlements.csv"),
      settlementRowSchema,
    );

    const settlementExternalToInternal = new Map<string, number>();

    if (settlementsResult.valid.length > 0) {
      const rows = settlementsResult.valid.map((r) => ({
        batchId,
        externalSettlementId: r.settlement_id,
        grossAmountPaise: rupeeStringToPaise(r.gross_amount),
        feeAmountPaise: rupeeStringToPaise(r.fee_amount),
        taxAmountPaise: rupeeStringToPaise(r.tax_amount),
        adjustmentAmountPaise: rupeeStringToPaise(r.adjustment_amount),
        reportedNetPaise: rupeeStringToPaise(r.net_amount),
        settledAt: normalizeTimestamp(r.settled_at),
        bankReference: r.bank_reference,
        rawPayload: r,
      }));

      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);

        const inserted = await tx
          .insert(settlements)
          .values(chunk)
          .returning({
            id: settlements.id,
            externalSettlementId: settlements.externalSettlementId,
          });

        for (const row of inserted) {
          settlementExternalToInternal.set(
            row.externalSettlementId,
            row.id,
          );
        }
      }
    }

    // ---- refunds ----
    const refundsResult = parseAndValidateCsv(
      path.join(datasetDir, "refunds.csv"),
      refundRowSchema,
    );

    const unresolvedRefundLinks: string[] = [];

    if (refundsResult.valid.length > 0) {
      const rows = refundsResult.valid.map((r) => {
        const internalPaymentId =
          paymentExternalToInternal.get(r.payment_id);

        if (internalPaymentId === undefined) {
          unresolvedRefundLinks.push(r.refund_id);
        }

        return {
          batchId,
          externalRefundId: r.refund_id,
          paymentId: internalPaymentId ?? null,
          amountPaise: rupeeStringToPaise(r.amount),
          status: normalizeStatus(r.status),
          createdAt: normalizeTimestamp(r.created_at),
          rawPayload: r,
        };
      });

      for (let i = 0; i < rows.length; i += 1000) {
        await tx.insert(refunds).values(rows.slice(i, i + 1000));
      }
    }

    // ---- bank transactions ----
    const bankResult = parseAndValidateCsv(
      path.join(datasetDir, "bank_transactions.csv"),
      bankTransactionRowSchema,
    );

    if (bankResult.valid.length > 0) {
      const rows = bankResult.valid.map((r) => ({
        batchId,
        externalBankId: r.bank_transaction_id,
        amountPaise: rupeeStringToPaise(r.amount),
        direction: r.direction,
        postedAt: normalizeTimestamp(r.posted_at),
        reference: r.reference,
        description: r.description,
        rawPayload: r,
      }));

      for (let i = 0; i < rows.length; i += 1000) {
        await tx
          .insert(bankTransactions)
          .values(rows.slice(i, i + 1000));
      }
    }

    // ---- adjustments ----
    const adjustmentsResult = parseAndValidateCsv(
      path.join(datasetDir, "adjustments.csv"),
      adjustmentRowSchema,
    );

    const unresolvedAdjustmentLinks: string[] = [];

    if (adjustmentsResult.valid.length > 0) {
      const rows = adjustmentsResult.valid.map((r) => {
        const internalSettlementId =
          settlementExternalToInternal.get(r.settlement_id);

        if (internalSettlementId === undefined) {
          unresolvedAdjustmentLinks.push(r.adjustment_id);
        }

        return {
          batchId,
          settlementId: internalSettlementId ?? null,
          externalAdjustmentId: r.adjustment_id,
          amountPaise: rupeeStringToPaise(r.amount),
          type: r.type,
          description: r.description,
          sourceReference: emptyToNull(r.source_reference),
        };
      });

      for (let i = 0; i < rows.length; i += 1000) {
        await tx
          .insert(adjustments)
          .values(rows.slice(i, i + 1000));
      }
    }

    const recordCount =
      paymentsResult.valid.length +
      refundsResult.valid.length +
      settlementsResult.valid.length +
      bankResult.valid.length +
      adjustmentsResult.valid.length;

    await tx
      .update(batches)
      .set({
        status: "completed",
        completedAt: new Date(),
        recordCount,
      })
      .where(eq(batches.id, batchId));

    return {
      batchId,
      counts: {
        payments: paymentsResult.valid.length,
        refunds: refundsResult.valid.length,
        settlements: settlementsResult.valid.length,
        bankTransactions: bankResult.valid.length,
        adjustments: adjustmentsResult.valid.length,
      },
      errors: {
        payments: paymentsResult.errors,
        refunds: refundsResult.errors,
        settlements: settlementsResult.errors,
        bankTransactions: bankResult.errors,
        adjustments: adjustmentsResult.errors,
      },
      unresolvedRefundLinks,
      unresolvedAdjustmentLinks,
    };
  });
}
