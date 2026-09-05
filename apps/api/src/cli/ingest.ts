/**
 * SettleGuard ingestion CLI.
 * Run: npm run ingest -- ../../datasets/demo demo-001
 */

import "dotenv/config";
import path from "node:path";
import { ingestDataset } from "../ingestion/ingest-batch.js";
import { pool } from "../db/client.js";

async function main() {
  const [datasetArg, batchNameArg] = process.argv.slice(2);
  if (!datasetArg) {
    console.error("Usage: npm run ingest -- <dataset-dir> [batch-name]");
    process.exit(1);
  }
  const datasetDir = path.resolve(process.cwd(), datasetArg);
  const batchName = batchNameArg ?? path.basename(datasetDir);

  console.log(`Ingesting ${datasetDir} as batch "${batchName}"...`);
  const summary = await ingestDataset(datasetDir, batchName);

  console.log("=".repeat(64));
  console.log(`Batch ${summary.batchId} ("${batchName}")`);
  console.log("=".repeat(64));
  for (const [key, count] of Object.entries(summary.counts)) {
    const errCount = summary.errors[key as keyof typeof summary.errors].length;
    console.log(`  ${key.padEnd(16)} ${String(count).padStart(6)} inserted${errCount ? `   ${errCount} row(s) failed validation` : ""}`);
  }
  if (summary.unresolvedRefundLinks.length > 0) {
    console.log(`\n  ${summary.unresolvedRefundLinks.length} refund(s) had no matching payment: ${summary.unresolvedRefundLinks.join(", ")}`);
  }
  if (summary.unresolvedAdjustmentLinks.length > 0) {
    console.log(`  ${summary.unresolvedAdjustmentLinks.length} adjustment(s) had no matching settlement: ${summary.unresolvedAdjustmentLinks.join(", ")}`);
  }
  for (const [key, errs] of Object.entries(summary.errors)) {
    for (const e of errs.slice(0, 5)) {
      console.log(`  [${key}] row ${e.row}: ${e.issues.join("; ")}`);
    }
  }
  console.log("=".repeat(64));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
