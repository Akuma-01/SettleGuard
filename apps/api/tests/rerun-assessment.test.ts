import { describe, expect, it } from "vitest";
import type { ExceptionRecord } from "../src/db/schema.js";
import { assessRerun } from "../src/policy/rerun-assessment.js";

const original: ExceptionRecord = {
  id: 10,
  runId: 4,
  type: "FEE_MISMATCH",
  severity: "medium",
  status: "OPEN",
  amountAtRiskPaise: 500,
  primaryRecordType: "settlement",
  primaryRecordId: 2,
  summary: "fee mismatch",
  deterministicEvidenceJson: {},
  createdAt: new Date("2026-09-01T00:00:00Z"),
  resolvedAt: null,
};

function candidate(overrides: Partial<ExceptionRecord>): ExceptionRecord {
  return { ...original, id: 20, runId: 5, createdAt: new Date("2026-09-02T00:00:00Z"), ...overrides };
}

describe("assessRerun", () => {
  it("marks the original exception cleared only when its record is absent from the fresh run", () => {
    expect(assessRerun(original, 5, [candidate({ id: 21, primaryRecordId: 9 })])).toEqual({
      outcome: "cleared",
      relatedExceptionIds: [],
    });
  });

  it("detects a persistent exception on the same trusted record", () => {
    expect(assessRerun(original, 5, [candidate({ id: 22 }), candidate({ id: 21 })])).toEqual({
      outcome: "persisted",
      relatedExceptionIds: [21, 22],
    });
  });

  it("requires review when the same record returns under a different classification", () => {
    expect(assessRerun(original, 5, [
      candidate({ id: 23, type: "UNKNOWN_ADJUSTMENT" }),
      candidate({ id: 22, type: "BANK_CREDIT_MISMATCH" }),
    ])).toEqual({
      outcome: "changed",
      relatedExceptionIds: [22, 23],
      replacementTypes: ["BANK_CREDIT_MISMATCH", "UNKNOWN_ADJUSTMENT"],
    });
  });

  it("ignores matching exceptions from runs other than the declared rerun", () => {
    expect(assessRerun(original, 5, [candidate({ id: 24, runId: 6 })])).toMatchObject({ outcome: "cleared" });
  });

  it("fails closed when the original exception has no primary-record identity", () => {
    expect(assessRerun({ ...original, primaryRecordId: null }, 5, [])).toEqual({
      outcome: "indeterminate",
      relatedExceptionIds: [],
      reason: "PRIMARY_RECORD_IDENTITY_MISSING",
    });
  });

  it("rejects reuse of the original run as proof", () => {
    expect(() => assessRerun(original, original.runId, [])).toThrow(/fresh reconciliation run/);
  });
});
