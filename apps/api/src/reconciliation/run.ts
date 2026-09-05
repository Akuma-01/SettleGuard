/**
 * SettleGuard reconciliation orchestrator.
 * Loads everything for a batch once (small enough at these scales to
 * do the matching in memory rather than issuing per-settlement
 * queries), runs settlement + bank matching and every exception
 * detector, writes matches/exceptions/settlement_items, updates each
 * settlement's expected_net_paise, and records run-level stats.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  adjustments,
  bankTransactions,
  exceptions as exceptionsTable,
  matches,
  payments,
  reconciliationRuns,
  refunds,
  settlementItems,
  settlements,
} from "../db/schema.js";
import { reconcileSettlement } from "./settlement-reconciler.js";
import { matchBankTransactions } from "./bank-reconciler.js";
import { detectDuplicateRefunds } from "./duplicate-refunds.js";

export interface ReconciliationSummary {
  runId: number;
  totalRecords: number;
  matchedRecords: number;
  unmatchedRecords: number;
  matchRate: number;
  exceptionCount: number;
  byType: Record<string, number>;
}

function settlementItemKey(item: Pick<typeof settlementItems.$inferInsert, "settlementId" | "itemType" | "paymentId" | "refundId">): string {
  return `${item.settlementId}:${item.itemType}:${item.paymentId ?? "-"}:${item.refundId ?? "-"}`;
}

export async function runReconciliation(batchId: number): Promise<ReconciliationSummary> {
  const [run] = await db.insert(reconciliationRuns).values({ batchId, status: "processing", startedAt: new Date() }).returning();
  const runId = run!.id;

  const allPayments = await db.select().from(payments).where(eq(payments.batchId, batchId));
  const allRefunds = await db.select().from(refunds).where(eq(refunds.batchId, batchId));
  const allSettlements = await db.select().from(settlements).where(eq(settlements.batchId, batchId));
  const allBankTxns = await db.select().from(bankTransactions).where(eq(bankTransactions.batchId, batchId));
  const allAdjustments = await db.select().from(adjustments).where(eq(adjustments.batchId, batchId));
  const existingItemRows = allSettlements.length > 0
    ? await db.select().from(settlementItems).where(inArray(settlementItems.settlementId, allSettlements.map((settlement) => settlement.id)))
    : [];
  const existingItemKeys = new Set(existingItemRows.map(settlementItemKey));

  const refundsByPaymentId = new Map<number, typeof allRefunds>();
  for (const r of allRefunds) {
    if (r.paymentId === null) continue;
    const list = refundsByPaymentId.get(r.paymentId) ?? [];
    list.push(r);
    refundsByPaymentId.set(r.paymentId, list);
  }
  const adjustmentsBySettlementId = new Map<number, typeof allAdjustments>();
  for (const a of allAdjustments) {
    if (a.settlementId === null) continue;
    const list = adjustmentsBySettlementId.get(a.settlementId) ?? [];
    list.push(a);
    adjustmentsBySettlementId.set(a.settlementId, list);
  }

  const allExceptionRows: Array<typeof exceptionsTable.$inferInsert> = [];
  const allItemRows: Array<typeof settlementItems.$inferInsert> = [];
  const allMatchRows: Array<typeof matches.$inferInsert> = [];

  // ---- Settlement-side reconciliation (Steps 5, 8, part of 10) ----
  for (const settlement of allSettlements) {
    const result = reconcileSettlement(settlement, allPayments, refundsByPaymentId, adjustmentsBySettlementId.get(settlement.id) ?? []);

    await db.update(settlements).set({ expectedNetPaise: result.expectedNetPaise }).where(eq(settlements.id, settlement.id));

    for (const item of result.items) {
      const itemRow = {
        settlementId: item.settlementId,
        paymentId: item.paymentId,
        refundId: item.refundId,
        itemType: item.itemType,
        amountPaise: item.amountPaise,
      };
      const itemKey = settlementItemKey(itemRow);
      if (!existingItemKeys.has(itemKey)) {
        allItemRows.push(itemRow);
        existingItemKeys.add(itemKey);
      }
      if (item.itemType === "payment") {
        allMatchRows.push({
          runId,
          sourceType: "payment",
          sourceId: item.paymentId!,
          targetType: "settlement",
          targetId: settlement.id,
          matchType: "stage_b",
          score: 100,
          status: "matched",
          evidenceJson: { via: "captured_at date-window inference" },
        });
      }
    }
    for (const exc of result.exceptions) {
      allExceptionRows.push({
        runId,
        type: exc.type,
        severity: exc.amountAtRiskPaise > 100000 ? "high" : "medium",
        status: "OPEN",
        amountAtRiskPaise: exc.amountAtRiskPaise,
        primaryRecordType: exc.primaryRecordType,
        primaryRecordId: exc.primaryRecordId,
        summary: exc.summary,
        deterministicEvidenceJson: exc.evidence,
      });
    }
  }

  // ---- Refund -> payment matches (foreign keys resolved during ingestion) ----
  for (const r of allRefunds) {
    if (r.paymentId === null) continue;
    allMatchRows.push({
      runId,
      sourceType: "refund",
      sourceId: r.id,
      targetType: "payment",
      targetId: r.paymentId,
      matchType: "stage_a",
      score: 100,
      status: "matched",
      evidenceJson: { via: "external_payment_id FK resolved during ingestion" },
    });
  }

  // ---- Bank-side reconciliation (Steps 5-7, 9, part of 10) ----
  const bankResults = matchBankTransactions(allBankTxns, allSettlements);
  for (const br of bankResults) {
    if (br.settlementId !== null) {
      allMatchRows.push({
        runId,
        sourceType: "bank_transaction",
        sourceId: br.bankTransactionId,
        targetType: "settlement",
        targetId: br.settlementId,
        matchType: br.matchType,
        score: br.score,
        status: "matched",
        evidenceJson: {},
      });
    }
    for (const exc of br.exceptions) {
      allExceptionRows.push({
        runId,
        type: exc.type,
        severity: exc.amountAtRiskPaise > 100000 ? "high" : "medium",
        status: "OPEN",
        amountAtRiskPaise: exc.amountAtRiskPaise,
        primaryRecordType: exc.primaryRecordType,
        primaryRecordId: exc.primaryRecordId,
        summary: exc.summary,
        deterministicEvidenceJson: exc.evidence,
      });
    }
  }

  // ---- Duplicate refunds (Step 10, part — global, independent of settlement matching) ----
  const dupExceptions = detectDuplicateRefunds(allRefunds);
  for (const exc of dupExceptions) {
    allExceptionRows.push({
      runId,
      type: exc.type,
      severity: "high",
      status: "OPEN",
      amountAtRiskPaise: exc.amountAtRiskPaise,
      primaryRecordType: exc.primaryRecordType,
      primaryRecordId: exc.primaryRecordId,
      summary: exc.summary,
      deterministicEvidenceJson: exc.evidence,
    });
  }

  // ---- Write everything ----
  if (allItemRows.length > 0) await db.insert(settlementItems).values(allItemRows);
  if (allMatchRows.length > 0) await db.insert(matches).values(allMatchRows);
  if (allExceptionRows.length > 0) await db.insert(exceptionsTable).values(allExceptionRows);

  // Match rate: matchable records minus every record flagged by any
  // exception, keyed by (type, id) so the same record isn't double
  // counted across two different exceptions on it — same approach as
  // Preserve deterministic ordering for reproducible reconciliation.
  const totalRecords = allPayments.length + allRefunds.length + allSettlements.length + allBankTxns.length + allAdjustments.length;
  const flagged = new Set<string>();
  for (const e of allExceptionRows) flagged.add(`${e.primaryRecordType}:${e.primaryRecordId}`);
  const matchedRecords = totalRecords - flagged.size;
  const unmatchedRecords = flagged.size;
  const matchRate = totalRecords > 0 ? matchedRecords / totalRecords : 0;

  const byType: Record<string, number> = {};
  for (const e of allExceptionRows) byType[e.type as string] = (byType[e.type as string] ?? 0) + 1;

  await db
    .update(reconciliationRuns)
    .set({
      status: "completed",
      completedAt: new Date(),
      totalRecords,
      matchedRecords,
      unmatchedRecords,
      matchRate,
      exceptionCount: allExceptionRows.length,
    })
    .where(eq(reconciliationRuns.id, runId));

  return { runId, totalRecords, matchedRecords, unmatchedRecords, matchRate, exceptionCount: allExceptionRows.length, byType };
}
