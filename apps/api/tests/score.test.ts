import { describe, expect, it } from "vitest";
import { groundTruthKey, scoreAgainstGroundTruth, type GroundTruthEntry } from "../src/benchmark/score.js";
import type { IdMaps } from "../src/benchmark/id-resolver.js";
import type { ExceptionRecord } from "../src/db/schema.js";

function mkIdMaps(overrides: Partial<IdMaps> = {}): IdMaps {
  return {
    paymentExternalToInternal: new Map(),
    refundExternalToInternal: new Map(),
    settlementExternalToInternal: new Map(),
    bankExternalToInternal: new Map(),
    adjustmentExternalToInternal: new Map(),
    ...overrides,
  };
}

let idSeq = 1;
function mkException(overrides: Partial<ExceptionRecord> = {}): ExceptionRecord {
  return {
    id: idSeq++,
    runId: 1,
    type: "FEE_MISMATCH",
    severity: "medium",
    status: "OPEN",
    amountAtRiskPaise: 1000,
    primaryRecordType: "settlement",
    primaryRecordId: 1,
    summary: "test",
    deterministicEvidenceJson: {},
    createdAt: new Date(),
    resolvedAt: null,
    ...overrides,
  };
}

describe("groundTruthKey — one case per exception type", () => {
  it("resolves MISSING_SETTLEMENT via detail.paymentId", () => {
    const idMaps = mkIdMaps({ paymentExternalToInternal: new Map([["PAY_1", 42]]) });
    const entry: GroundTruthEntry = { type: "MISSING_SETTLEMENT", recordIds: [], amountAtRiskPaise: 0, note: "", detail: { paymentId: "PAY_1" } };
    expect(groundTruthKey(entry, idMaps)).toBe("MISSING_SETTLEMENT:payment:42");
  });

  it("resolves FEE_MISMATCH via detail.settlementId", () => {
    const idMaps = mkIdMaps({ settlementExternalToInternal: new Map([["SET_1", 7]]) });
    const entry: GroundTruthEntry = { type: "FEE_MISMATCH", recordIds: [], amountAtRiskPaise: 0, note: "", detail: { settlementId: "SET_1" } };
    expect(groundTruthKey(entry, idMaps)).toBe("FEE_MISMATCH:settlement:7");
  });

  it("resolves UNKNOWN_ADJUSTMENT via detail.adjustmentId (not settlementId)", () => {
    const idMaps = mkIdMaps({ adjustmentExternalToInternal: new Map([["ADJ_1", 9]]), settlementExternalToInternal: new Map([["SET_1", 999]]) });
    const entry: GroundTruthEntry = {
      type: "UNKNOWN_ADJUSTMENT",
      recordIds: [],
      amountAtRiskPaise: 0,
      note: "",
      detail: { settlementId: "SET_1", adjustmentId: "ADJ_1" },
    };
    // Must resolve on the adjustment, not accidentally key off the settlement.
    expect(groundTruthKey(entry, idMaps)).toBe("UNKNOWN_ADJUSTMENT:adjustment:9");
  });

  it("resolves DUPLICATE_REFUND via detail.duplicateRefundId (not originalRefundId)", () => {
    const idMaps = mkIdMaps({ refundExternalToInternal: new Map([["REF_orig", 5], ["REF_dup", 6]]) });
    const entry: GroundTruthEntry = {
      type: "DUPLICATE_REFUND",
      recordIds: [],
      amountAtRiskPaise: 0,
      note: "",
      detail: { originalRefundId: "REF_orig", duplicateRefundId: "REF_dup" },
    };
    expect(groundTruthKey(entry, idMaps)).toBe("DUPLICATE_REFUND:refund:6");
  });

  it("returns null when the external ID can't be resolved (e.g. wrong batch)", () => {
    const idMaps = mkIdMaps(); // empty — nothing resolves
    const entry: GroundTruthEntry = { type: "FEE_MISMATCH", recordIds: [], amountAtRiskPaise: 0, note: "", detail: { settlementId: "SET_1" } };
    expect(groundTruthKey(entry, idMaps)).toBeNull();
  });
});

describe("scoreAgainstGroundTruth — perfect match", () => {
  it("scores 100% precision and 100% recall when every entry has a matching detection", () => {
    const idMaps = mkIdMaps({ settlementExternalToInternal: new Map([["SET_1", 1]]) });
    const groundTruth: GroundTruthEntry[] = [{ type: "FEE_MISMATCH", recordIds: [], amountAtRiskPaise: 500, note: "", detail: { settlementId: "SET_1" } }];
    const detected = [mkException({ type: "FEE_MISMATCH", primaryRecordType: "settlement", primaryRecordId: 1 })];

    const result = scoreAgainstGroundTruth(groundTruth, detected, idMaps);

    expect(result.precision).toBe(1);
    expect(result.recall).toBe(1);
    expect(result.truePositives).toBe(1);
    expect(result.falsePositives).toBe(0);
    expect(result.falseNegatives).toBe(0);
    expect(result.missedEntries).toHaveLength(0);
    expect(result.extraExceptions).toHaveLength(0);
  });
});

describe("scoreAgainstGroundTruth — the fail path", () => {
  it("scores a false negative: a ground truth entry with no detection lowers recall, not precision", () => {
    const idMaps = mkIdMaps({ settlementExternalToInternal: new Map([["SET_1", 1], ["SET_2", 2]]) });
    const groundTruth: GroundTruthEntry[] = [
      { type: "FEE_MISMATCH", recordIds: [], amountAtRiskPaise: 500, note: "found", detail: { settlementId: "SET_1" } },
      { type: "FEE_MISMATCH", recordIds: [], amountAtRiskPaise: 700, note: "missed", detail: { settlementId: "SET_2" } },
    ];
    // Only SET_1's exception was actually detected — SET_2's was missed entirely.
    const detected = [mkException({ type: "FEE_MISMATCH", primaryRecordType: "settlement", primaryRecordId: 1 })];

    const result = scoreAgainstGroundTruth(groundTruth, detected, idMaps);

    expect(result.recall).toBe(0.5);
    expect(result.precision).toBe(1); // everything that WAS detected was correct
    expect(result.falseNegatives).toBe(1);
    expect(result.missedEntries).toHaveLength(1);
    expect(result.missedEntries[0]!.note).toBe("missed");
  });

  it("scores a false positive: a detected exception with no ground truth entry lowers precision, not recall", () => {
    const idMaps = mkIdMaps({ settlementExternalToInternal: new Map([["SET_1", 1]]) });
    const groundTruth: GroundTruthEntry[] = [{ type: "FEE_MISMATCH", recordIds: [], amountAtRiskPaise: 500, note: "", detail: { settlementId: "SET_1" } }];
    // Settlement 1's real exception, PLUS a spurious extra on settlement 99 that ground truth never injected.
    const detected = [
      mkException({ type: "FEE_MISMATCH", primaryRecordType: "settlement", primaryRecordId: 1 }),
      mkException({ type: "FEE_MISMATCH", primaryRecordType: "settlement", primaryRecordId: 99, summary: "spurious" }),
    ];

    const result = scoreAgainstGroundTruth(groundTruth, detected, idMaps);

    expect(result.recall).toBe(1); // the real one was still found
    expect(result.precision).toBe(0.5); // but half of what was flagged wasn't real
    expect(result.falsePositives).toBe(1);
    expect(result.extraExceptions).toHaveLength(1);
    expect(result.extraExceptions[0]!.summary).toBe("spurious");
  });

  it("byType breaks down ground truth / detected / matched independently per type", () => {
    const idMaps = mkIdMaps({ settlementExternalToInternal: new Map([["SET_1", 1], ["SET_2", 2]]) });
    const groundTruth: GroundTruthEntry[] = [
      { type: "FEE_MISMATCH", recordIds: [], amountAtRiskPaise: 500, note: "", detail: { settlementId: "SET_1" } },
      { type: "BANK_CREDIT_MISMATCH", recordIds: [], amountAtRiskPaise: 500, note: "", detail: { settlementId: "SET_2" } },
    ];
    const detected = [
      mkException({ type: "FEE_MISMATCH", primaryRecordType: "settlement", primaryRecordId: 1 }),
      // BANK_CREDIT_MISMATCH never detected; an unrelated AMBIGUOUS_MATCH fires instead (false positive of a third type).
      mkException({ type: "AMBIGUOUS_MATCH", primaryRecordType: "settlement", primaryRecordId: 2 }),
    ];

    const result = scoreAgainstGroundTruth(groundTruth, detected, idMaps);

    expect(result.byType["FEE_MISMATCH"]).toEqual({ groundTruth: 1, detected: 1, matched: 1 });
    expect(result.byType["BANK_CREDIT_MISMATCH"]).toEqual({ groundTruth: 1, detected: 0, matched: 0 });
    expect(result.byType["AMBIGUOUS_MATCH"]).toEqual({ groundTruth: 0, detected: 1, matched: 0 });
  });
});
