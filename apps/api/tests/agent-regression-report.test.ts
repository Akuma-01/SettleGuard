import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AGENT_REGRESSION_REPORT_VERSION, createAgentRegressionReport, writeAgentRegressionReport } from "../src/agent/regression-report.js";
import type { AgentRegressionSummary } from "../src/agent/regression.js";

const outputDirectory = path.join("/tmp", `settleguard-regression-report-${process.pid}`);
const summary: AgentRegressionSummary = {
  total: 1,
  passed: 0,
  failed: 1,
  passRate: 0,
  aiErrorCount: 1,
  unsafeResolutionCount: 0,
  results: [{
    case: {
      name: "fee mismatch",
      exceptionId: 7,
      exceptionType: "FEE_MISMATCH",
      expectedRootCauses: ["fee_mismatch"],
      expectedActions: ["create_review_case"],
      requiresHumanApproval: true,
    },
    outcome: { status: "ai_error", reason: "provider timeout", rawResponse: "" },
    passed: false,
    checks: { completed: false, exceptionIdentity: false, rootCause: false, recommendedAction: false, humanApproval: false, safeUnresolved: true },
    failures: ["completed", "exceptionIdentity", "rootCause", "recommendedAction", "humanApproval"],
  }],
};

afterAll(async () => rm(outputDirectory, { recursive: true, force: true }));

describe("agent regression report", () => {
  it("captures reproducibility metadata and the honest failed result", () => {
    const report = createAgentRegressionReport({
      reconciliationRunId: 12,
      model: "test-model",
      promptVersion: "test-v1",
      summary,
      generatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(report).toMatchObject({
      schemaVersion: AGENT_REGRESSION_REPORT_VERSION,
      generatedAt: "2026-09-01T00:00:00.000Z",
      reconciliationRunId: 12,
      model: "test-model",
      promptVersion: "test-v1",
      summary: { failed: 1, aiErrorCount: 1 },
    });
  });

  it("rejects incomplete provenance", () => {
    expect(() => createAgentRegressionReport({ reconciliationRunId: 0, model: "x", promptVersion: "v1", summary })).toThrow(/positive integer/);
    expect(() => createAgentRegressionReport({ reconciliationRunId: 1, model: " ", promptVersion: "v1", summary })).toThrow(/required/);
  });

  it("writes valid JSON atomically to the stable report filename", async () => {
    const report = createAgentRegressionReport({ reconciliationRunId: 12, model: "test-model", promptVersion: "test-v1", summary });
    await mkdir(outputDirectory, { recursive: true });
    const reportPath = await writeAgentRegressionReport(outputDirectory, report);
    expect(reportPath).toBe(path.join(outputDirectory, "regression-report.json"));
    expect(JSON.parse(await readFile(reportPath, "utf-8"))).toEqual(report);
  });
});
