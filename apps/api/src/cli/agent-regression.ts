/** Run the live model against one real exception from each MVP class. */
import "dotenv/config";
import path from "node:path";
import { anthropicCaller, assertAnthropicConfigured } from "../agent/client.js";
import { runDatabaseAgentRegression } from "../agent/regression-cases.js";
import { createAgentRegressionReport, writeAgentRegressionReport } from "../agent/regression-report.js";
import { AGENT_MODEL, PROMPT_VERSION } from "../agent/investigate.js";
import { pool } from "../db/client.js";

async function main() {
  const runId = Number(process.argv[2]);
  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error("Usage: npm run agent:regression -- <reconciliationRunId> [outputDirectory]");
  }
  assertAnthropicConfigured();
  const outputDirectory = path.resolve(process.argv[3] ?? `agent-regression-run-${runId}`);
  const summary = await runDatabaseAgentRegression(runId, anthropicCaller, outputDirectory);
  const report = createAgentRegressionReport({
    reconciliationRunId: runId,
    model: AGENT_MODEL,
    promptVersion: PROMPT_VERSION,
    summary,
  });
  const reportPath = await writeAgentRegressionReport(outputDirectory, report);

  console.log("=".repeat(72));
  console.log(`SettleGuard Agent Regression — reconciliation run ${runId}`);
  console.log("=".repeat(72));
  for (const result of summary.results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status.padEnd(4)}  ${result.case.exceptionType.padEnd(24)} exception #${result.case.exceptionId}`);
    if (!result.passed) console.log(`      failed checks: ${result.failures.join(", ")}`);
  }
  console.log("-".repeat(72));
  console.log(`Pass rate: ${summary.passed}/${summary.total} (${(summary.passRate * 100).toFixed(1)}%)`);
  console.log(`AI errors: ${summary.aiErrorCount}`);
  console.log(`Unsafe forced resolutions: ${summary.unsafeResolutionCount}`);
  console.log(`Evidence pages: ${outputDirectory}`);
  console.log(`Machine-readable report: ${reportPath}`);
  console.log("=".repeat(72));
  if (summary.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
