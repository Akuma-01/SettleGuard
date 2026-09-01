/** Versioned, machine-readable evidence for an agent regression run. */
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRegressionSummary } from "./regression.js";

export const AGENT_REGRESSION_REPORT_VERSION = 1;

export interface AgentRegressionReport {
  schemaVersion: number;
  generatedAt: string;
  reconciliationRunId: number;
  model: string;
  promptVersion: string;
  summary: AgentRegressionSummary;
}

export function createAgentRegressionReport(input: {
  reconciliationRunId: number;
  model: string;
  promptVersion: string;
  summary: AgentRegressionSummary;
  generatedAt?: Date;
}): AgentRegressionReport {
  if (!Number.isInteger(input.reconciliationRunId) || input.reconciliationRunId <= 0) {
    throw new Error("reconciliationRunId must be a positive integer");
  }
  if (!input.model.trim() || !input.promptVersion.trim()) throw new Error("model and promptVersion are required");
  return {
    schemaVersion: AGENT_REGRESSION_REPORT_VERSION,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    reconciliationRunId: input.reconciliationRunId,
    model: input.model,
    promptVersion: input.promptVersion,
    summary: input.summary,
  };
}

export async function writeAgentRegressionReport(outputDirectory: string, report: AgentRegressionReport): Promise<string> {
  const reportPath = path.join(outputDirectory, "regression-report.json");
  const temporaryPath = path.join(outputDirectory, `.regression-report-${process.pid}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await rename(temporaryPath, reportPath);
  return reportPath;
}
