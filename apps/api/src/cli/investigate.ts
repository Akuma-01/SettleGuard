/**
 * SettleGuard investigation CLI.
 * Run: npm run investigate -- <exceptionId>
 */

import "dotenv/config";
import path from "node:path";
import { investigateException } from "../agent/investigate.js";
import { assertAgentProviderConfigured, configuredAgentProvider, configuredModelCaller } from "../agent/client.js";
import { pool } from "../db/client.js";

async function main() {
  const exceptionIdArg = process.argv[2];
  if (!exceptionIdArg) {
    console.error("Usage: npm run investigate -- <exceptionId>");
    process.exit(1);
  }
  const exceptionId = parseInt(exceptionIdArg, 10);
  assertAgentProviderConfigured();
  const outputPath = path.resolve(process.cwd(), `investigation-${exceptionId}.html`);

  console.log(`Investigating exception ${exceptionId} with ${configuredAgentProvider()}...`);
  const summary = await investigateException(exceptionId, configuredModelCaller, outputPath);

  console.log("=".repeat(64));
  console.log(`Investigation ${summary.investigationId} — ${summary.outcomeStatus}`);
  console.log("=".repeat(64));
  console.log(summary.policyDecision);
  console.log();
  console.log(`Evidence page: ${summary.evidencePagePath}`);
  console.log("=".repeat(64));

  await pool.end();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
