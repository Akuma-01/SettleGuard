/**
 * SettleGuard benchmark harness.
 * Performs fresh ingestion, timed reconciliation, and scoring against the
 * dataset's ground_truth.json without cached measurements.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { exceptions as exceptionsTable } from "../db/schema.js";
import { ingestDataset } from "../ingestion/ingest-batch.js";
import { runReconciliation } from "../reconciliation/run.js";
import { buildIdMaps } from "./id-resolver.js";
import { scoreAgainstGroundTruth, type GroundTruthEntry, type ScoreResult } from "./score.js";

export interface BenchmarkReport {
  dataset: string;
  batchId: number;
  runId: number;
  recordCounts: { payments: number; refunds: number; settlements: number; bankTransactions: number; adjustments: number };
  totalRecords: number;
  matchRate: number;
  throughputRecordsPerSecond: number;
  reconciliationDurationMs: number;
  score: ScoreResult;
}

export async function runBenchmark(datasetDir: string, datasetName: string): Promise<BenchmarkReport> {
  const groundTruthPath = path.join(datasetDir, "ground_truth.json");
  if (!existsSync(groundTruthPath)) {
    throw new Error(
      `No ground_truth.json found at ${groundTruthPath}. Generate the dataset first, e.g.: (from the project root) npm run generate:${datasetName}`,
    );
  }
  const groundTruth = JSON.parse(readFileSync(groundTruthPath, "utf-8")) as { injectedExceptions: GroundTruthEntry[] };

  // Fresh batch every run — repeatable, no dependency on prior state.
  const ingestSummary = await ingestDataset(datasetDir, `benchmark-${datasetName}-${Date.now()}`);
  const batchId = ingestSummary.batchId;

  const startedAt = Date.now();
  const reconSummary = await runReconciliation(batchId);
  const reconciliationDurationMs = Date.now() - startedAt;

  const detected = await db.select().from(exceptionsTable).where(eq(exceptionsTable.runId, reconSummary.runId));
  const idMaps = await buildIdMaps(batchId);
  const score = scoreAgainstGroundTruth(groundTruth.injectedExceptions, detected, idMaps);

  const throughputRecordsPerSecond = reconciliationDurationMs > 0 ? reconSummary.totalRecords / (reconciliationDurationMs / 1000) : 0;

  return {
    dataset: datasetName,
    batchId,
    runId: reconSummary.runId,
    recordCounts: ingestSummary.counts,
    totalRecords: reconSummary.totalRecords,
    matchRate: reconSummary.matchRate,
    throughputRecordsPerSecond,
    reconciliationDurationMs,
    score,
  };
}
