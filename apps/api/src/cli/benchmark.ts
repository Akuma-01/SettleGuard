/**
 * SettleGuard — Phase 3: benchmark CLI.
 * Run: npm run benchmark              (defaults to the benchmark dataset)
 *      npm run benchmark -- --dataset demo
 */

import "dotenv/config";
import path from "node:path";
import { runBenchmark } from "../benchmark/run-benchmark.js";
import { pool } from "../db/client.js";

function inr(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? "-" : "";
  return `${sign}\u20B9${Math.abs(rupees).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--dataset");
  const datasetName = idx >= 0 ? args[idx + 1]! : "benchmark";
  const datasetDir = path.resolve(process.cwd(), "../../datasets", datasetName);

  console.log(`Running benchmark against the "${datasetName}" dataset...`);
  const report = await runBenchmark(datasetDir, datasetName);

  console.log("=".repeat(64));
  console.log("SettleGuard Benchmark");
  console.log("=".repeat(64));
  console.log(`Dataset:  ${report.dataset}`);
  console.log(`Batch:    ${report.batchId}`);
  console.log(`Records:  ${report.recordCounts.payments} payments (${report.totalRecords} total records)`);
  console.log();
  console.log(`Match rate: ${pct(report.matchRate)}`);
  console.log(`Precision:  ${pct(report.score.precision)}  (${report.score.truePositives}/${report.score.totalDetected} flagged exceptions were real)`);
  console.log(`Recall:     ${pct(report.score.recall)}  (${report.score.truePositives}/${report.score.totalGroundTruth} injected exceptions were caught)`);
  console.log(`Resolution accuracy: N/A — Phase 5 (policy engine) not built yet`);
  console.log(`Throughput: ${report.throughputRecordsPerSecond.toFixed(0)} records/sec (reconciliation only, ${report.reconciliationDurationMs}ms for ${report.totalRecords} records)`);
  console.log();
  console.log("By exception type (ground truth / detected / matched):");
  for (const [type, counts] of Object.entries(report.score.byType)) {
    console.log(`  ${type.padEnd(22)} ${String(counts.groundTruth).padStart(3)} / ${String(counts.detected).padStart(3)} / ${String(counts.matched).padStart(3)}`);
  }

  if (report.score.missedEntries.length > 0) {
    console.log();
    console.log(`MISSED (${report.score.missedEntries.length}) — in ground truth, not detected:`);
    for (const e of report.score.missedEntries) {
      console.log(`  [${e.type}] ${inr(e.amountAtRiskPaise)} — ${e.note}`);
    }
  }
  if (report.score.extraExceptions.length > 0) {
    console.log();
    console.log(`EXTRA (${report.score.extraExceptions.length}) — detected, no matching ground truth entry:`);
    for (const e of report.score.extraExceptions) {
      console.log(`  [${e.type}] ${inr(e.amountAtRiskPaise)} — ${e.summary}`);
    }
  }
  console.log("=".repeat(64));

  const passed = report.score.precision === 1 && report.score.recall === 1;
  console.log(passed ? "BENCHMARK PASSED: 100% precision, 100% recall." : "BENCHMARK FAILED: see MISSED/EXTRA above.");

  await pool.end();
  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
