/**
 * SettleGuard — Phase 2: reconcile CLI.
 * Run: npm run reconcile -- <batchId>
 */

import "dotenv/config";
import { runReconciliation } from "../reconciliation/run.js";
import { pool } from "../db/client.js";

async function main() {
  const batchIdArg = process.argv[2];
  if (!batchIdArg) {
    console.error("Usage: npm run reconcile -- <batchId>");
    process.exit(1);
  }
  const batchId = parseInt(batchIdArg, 10);

  console.log(`Running reconciliation for batch ${batchId}...`);
  const summary = await runReconciliation(batchId);

  console.log("=".repeat(64));
  console.log(`Reconciliation run ${summary.runId} — batch ${batchId}`);
  console.log("=".repeat(64));
  console.log(`Total records:   ${summary.totalRecords}`);
  console.log(`Matched:         ${summary.matchedRecords}`);
  console.log(`Unmatched:       ${summary.unmatchedRecords}`);
  console.log(`Match rate:      ${(summary.matchRate * 100).toFixed(2)}%`);
  console.log(`Exceptions:      ${summary.exceptionCount}`);
  console.log();
  for (const [type, count] of Object.entries(summary.byType)) {
    console.log(`  ${type.padEnd(22)} ${count}`);
  }
  console.log("=".repeat(64));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
