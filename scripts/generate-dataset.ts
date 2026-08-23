/**
 * SettleGuard — Phase 1, Step 2: the real synthetic data generator.
 *
 * Run:
 *   npx tsx scripts/generate-dataset.ts --preset tiny
 *   npx tsx scripts/generate-dataset.ts --preset demo
 *   npx tsx scripts/generate-dataset.ts --preset benchmark
 *
 * Pipeline (order matters — see comments inline):
 *   payments -> refunds -> group into settlements (correct, Pass 1)
 *   -> inject missingSettlement, feeMismatch, unknownAdjustment
 *   -> finalize settlement nets -> generate bank transactions (from the
 *      now-finalized, possibly-corrupted settlements)
 *   -> inject bankAmountMismatch, ambiguousReference (bank-side only)
 *   -> inject duplicateRefund (independent of settlement math)
 *   -> write CSVs + ground_truth.json
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatasetConfig, GeneratedDataset } from "./generator/types.js";
import { mulberry32, inr } from "./generator/utils.js";
import { generatePayments, generateRefunds } from "./generator/payments.js";
import { groupIntoSettlements, generateBankTransactions } from "./generator/settlements.js";
import { injectAllExceptions, injectBankStageExceptions } from "./generator/exceptions.js";
import { writeCsv } from "./generator/csv.js";

const PRESETS: Record<string, DatasetConfig> = {
  tiny: {
    name: "tiny",
    seed: 42,
    paymentCount: 50,
    refundRate: 0.2,
    daySpan: 3,
    baseDate: "2026-03-01",
    exceptions: { missingSettlement: 1, duplicateRefund: 1, feeMismatch: 1, bankAmountMismatch: 1, unknownAdjustment: 1, ambiguousReference: 0 },
    outDir: null, // console-only — this is today's hand-verification run
  },
  demo: {
    name: "demo",
    seed: 42,
    paymentCount: 500,
    refundRate: 0.12,
    daySpan: 30,
    baseDate: "2026-03-01",
    exceptions: { missingSettlement: 3, duplicateRefund: 3, feeMismatch: 4, bankAmountMismatch: 4, unknownAdjustment: 3, ambiguousReference: 2 },
    outDir: "datasets/demo",
  },
  benchmark: {
    name: "benchmark",
    seed: 42,
    paymentCount: 5000,
    refundRate: 0.12,
    daySpan: 120,
    baseDate: "2026-03-01",
    // Exact distribution from the architecture doc's own sample config.
    exceptions: { missingSettlement: 20, duplicateRefund: 20, feeMismatch: 25, bankAmountMismatch: 25, unknownAdjustment: 20, ambiguousReference: 15 },
    outDir: "datasets/benchmark",
  },
};

function parseArgs(): { preset: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--preset");
  const preset = idx >= 0 ? args[idx + 1] : "tiny";
  if (!preset || !PRESETS[preset]) {
    console.error(`Unknown or missing --preset. Choose one of: ${Object.keys(PRESETS).join(", ")}`);
    process.exit(1);
  }
  return { preset };
}

function generate(config: DatasetConfig): GeneratedDataset {
  const rand = mulberry32(config.seed);

  const payments = generatePayments(config, rand);
  const refunds = generateRefunds(payments, config, rand);
  const grouping = groupIntoSettlements(payments, refunds);
  const { settlements } = grouping;

  const stage1 = injectAllExceptions(grouping, payments, refunds, settlements, config.exceptions, rand);

  const bankTransactions = generateBankTransactions(settlements);
  const stage2GroundTruth = injectBankStageExceptions(
    bankTransactions,
    { bankAmountMismatch: config.exceptions.bankAmountMismatch, ambiguousReference: config.exceptions.ambiguousReference },
    rand,
  );

  return {
    config,
    payments,
    refunds,
    settlements,
    bankTransactions,
    adjustments: stage1.adjustments,
    groundTruth: [...stage1.groundTruth, ...stage2GroundTruth],
  };
}

function writeDataset(ds: GeneratedDataset): void {
  if (!ds.config.outDir) return;
  const dir = path.resolve(ds.config.outDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeCsv(
    path.join(dir, "payments.csv"),
    ds.payments.map((p) => ({
      payment_id: p.id,
      order_id: p.orderId,
      amount: (p.amountPaise / 100).toFixed(2),
      currency: p.currency,
      status: p.status,
      captured_at: p.capturedAt,
      method: p.method,
      merchant_reference: p.merchantReference,
    })),
    ["payment_id", "order_id", "amount", "currency", "status", "captured_at", "method", "merchant_reference"],
  );

  writeCsv(
    path.join(dir, "refunds.csv"),
    ds.refunds.map((r) => ({
      refund_id: r.id,
      payment_id: r.paymentId,
      amount: (r.amountPaise / 100).toFixed(2),
      status: r.status,
      created_at: r.createdAt,
    })),
    ["refund_id", "payment_id", "amount", "status", "created_at"],
  );

  writeCsv(
    path.join(dir, "settlements.csv"),
    ds.settlements.map((s) => ({
      settlement_id: s.id,
      day: s.dayBucket,
      gross_amount: (s.grossAmountPaise / 100).toFixed(2),
      fee_amount: (s.feeAmountPaise / 100).toFixed(2),
      tax_amount: (s.taxAmountPaise / 100).toFixed(2),
      adjustment_amount: (s.adjustmentAmountPaise / 100).toFixed(2),
      net_amount: (s.reportedNetPaise / 100).toFixed(2),
      settled_at: s.settledAt,
      bank_reference: s.bankReference,
    })),
    ["settlement_id", "day", "gross_amount", "fee_amount", "tax_amount", "adjustment_amount", "net_amount", "settled_at", "bank_reference"],
  );

  // Deliberately NO settlement_id column here. A real bank statement line
  // doesn't arrive pre-linked to your internal settlement ID — that link
  // is exactly what Phase 2's matcher has to earn. It's kept in
  // ground_truth.json (below) as the answer key, not leaked into the
  // "real-world" file.
  writeCsv(
    path.join(dir, "bank_transactions.csv"),
    ds.bankTransactions.map((b) => ({
      bank_transaction_id: b.id,
      amount: (b.amountPaise / 100).toFixed(2),
      direction: b.direction,
      posted_at: b.postedAt,
      reference: b.reference,
      description: b.description,
    })),
    ["bank_transaction_id", "amount", "direction", "posted_at", "reference", "description"],
  );

  writeCsv(
    path.join(dir, "adjustments.csv"),
    ds.adjustments.map((a) => ({
      adjustment_id: a.id,
      settlement_id: a.settlementId,
      amount: (a.amountPaise / 100).toFixed(2),
      type: a.type,
      description: a.description,
      source_reference: a.sourceReference ?? "",
    })),
    ["adjustment_id", "settlement_id", "amount", "type", "description", "source_reference"],
  );

  const groundTruthPath = path.join(dir, "ground_truth.json");
  writeFileSync(
    groundTruthPath,
    JSON.stringify(
      {
        dataset: ds.config.name,
        seed: ds.config.seed,
        generatedAt: new Date().toISOString(),
        config: ds.config,
        counts: {
          payments: ds.payments.length,
          refunds: ds.refunds.length,
          settlements: ds.settlements.length,
          bankTransactions: ds.bankTransactions.length,
          adjustments: ds.adjustments.length,
          injectedExceptions: ds.groundTruth.length,
        },
        injectedExceptions: ds.groundTruth,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`Wrote ${ds.config.name} dataset to ${dir}/`);
}

function printSummary(ds: GeneratedDataset): void {
  const { config } = ds;
  console.log("=".repeat(64));
  console.log(`SettleGuard — Dataset: ${config.name}  (seed ${config.seed})`);
  console.log("=".repeat(64));
  console.log(`Payments:          ${ds.payments.length}`);
  console.log(`Refunds:           ${ds.refunds.length}`);
  console.log(`Settlements:       ${ds.settlements.length}`);
  console.log(`Bank transactions: ${ds.bankTransactions.length}`);
  console.log(`Adjustments:       ${ds.adjustments.length}`);
  console.log(`Injected exceptions: ${ds.groundTruth.length} requested ${Object.values(config.exceptions).reduce((a, b) => a + b, 0)}`);
  console.log();
  const byType = new Map<string, number>();
  for (const e of ds.groundTruth) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
  for (const [type, n] of byType) console.log(`  ${type.padEnd(22)} ${n}`);
  console.log();
  console.log("Ground truth detail:");
  for (const e of ds.groundTruth) {
    console.log(`  [${e.type}] ${inr(e.amountAtRiskPaise)} at risk — ${e.note}`);
  }

  if (config.outDir === null) {
    // Tiny/hand-verification mode — dump full records for the
    // settlements involved so every number can be checked by hand.
    console.log();
    console.log("-".repeat(64));
    console.log("Full settlement records (for hand verification):");
    console.log("-".repeat(64));
    for (const s of ds.settlements) {
      console.log(
        `${s.id}  gross=${inr(s.grossAmountPaise)}  fee=${inr(s.feeAmountPaise)}  tax=${inr(s.taxAmountPaise)}  adj=${inr(s.adjustmentAmountPaise)}  net=${inr(s.reportedNetPaise)}`,
      );
    }
    console.log();
    console.log("Full bank transaction records:");
    for (const b of ds.bankTransactions) {
      console.log(`${b.id}  settlement=${b.settlementId}  amount=${inr(b.amountPaise)}  reference=${b.reference}`);
    }
  }
  console.log("=".repeat(64));
}

const { preset } = parseArgs();
const config = PRESETS[preset]!;
const dataset = generate(config);
printSummary(dataset);
writeDataset(dataset);
