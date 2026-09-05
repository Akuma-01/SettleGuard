/**
 * Score detected exceptions against generated ground truth. Build a canonical
 * (type, recordType, internalId) key for every ground-truth entry
 * (resolving its external IDs via IdMaps) and for every detected
 * exception (already internal — type/primaryRecordType/primaryRecordId
 * are columns, not something to dig out of JSON evidence), then set-
 * compare the two key spaces.
 */

import type { ExceptionRecord } from "../db/schema.js";
import type { IdMaps } from "./id-resolver.js";

export interface GroundTruthEntry {
  type: string;
  recordIds: string[];
  amountAtRiskPaise: number;
  detail: Record<string, string | number | null>;
  note: string;
}

export interface ScoreResult {
  totalGroundTruth: number;
  totalDetected: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  missedEntries: GroundTruthEntry[];
  extraExceptions: ExceptionRecord[];
  byType: Record<string, { groundTruth: number; detected: number; matched: number }>;
}

/** Maps a ground-truth entry to the same (type, recordType, internalId) key a detected exception would carry, resolving whatever external ID that type's detail object uses. Null if the referenced external ID can't be resolved (e.g. batch mismatch). */
export function groundTruthKey(entry: GroundTruthEntry, idMaps: IdMaps): string | null {
  switch (entry.type) {
    case "MISSING_SETTLEMENT": {
      const id = idMaps.paymentExternalToInternal.get(entry.detail.paymentId as string);
      return id !== undefined ? `MISSING_SETTLEMENT:payment:${id}` : null;
    }
    case "FEE_MISMATCH": {
      const id = idMaps.settlementExternalToInternal.get(entry.detail.settlementId as string);
      return id !== undefined ? `FEE_MISMATCH:settlement:${id}` : null;
    }
    case "UNKNOWN_ADJUSTMENT": {
      const id = idMaps.adjustmentExternalToInternal.get(entry.detail.adjustmentId as string);
      return id !== undefined ? `UNKNOWN_ADJUSTMENT:adjustment:${id}` : null;
    }
    case "DUPLICATE_REFUND": {
      const id = idMaps.refundExternalToInternal.get(entry.detail.duplicateRefundId as string);
      return id !== undefined ? `DUPLICATE_REFUND:refund:${id}` : null;
    }
    case "BANK_CREDIT_MISMATCH": {
      const id = idMaps.settlementExternalToInternal.get(entry.detail.settlementId as string);
      return id !== undefined ? `BANK_CREDIT_MISMATCH:settlement:${id}` : null;
    }
    case "AMBIGUOUS_MATCH": {
      const id = idMaps.settlementExternalToInternal.get(entry.detail.settlementId as string);
      return id !== undefined ? `AMBIGUOUS_MATCH:settlement:${id}` : null;
    }
    default:
      return null;
  }
}

function detectedKey(exc: Pick<ExceptionRecord, "type" | "primaryRecordType" | "primaryRecordId">): string {
  return `${exc.type}:${exc.primaryRecordType}:${exc.primaryRecordId}`;
}

export function scoreAgainstGroundTruth(groundTruth: GroundTruthEntry[], detected: ExceptionRecord[], idMaps: IdMaps): ScoreResult {
  const detectedByKey = new Map<string, ExceptionRecord>();
  for (const exc of detected) detectedByKey.set(detectedKey(exc), exc);

  const matchedKeys = new Set<string>();
  const missedEntries: GroundTruthEntry[] = [];
  const byType: ScoreResult["byType"] = {};

  for (const entry of groundTruth) {
    byType[entry.type] ??= { groundTruth: 0, detected: 0, matched: 0 };
    byType[entry.type]!.groundTruth++;

    const key = groundTruthKey(entry, idMaps);
    if (key && detectedByKey.has(key)) {
      matchedKeys.add(key);
      byType[entry.type]!.matched++;
    } else {
      missedEntries.push(entry);
    }
  }

  for (const exc of detected) {
    byType[exc.type] ??= { groundTruth: 0, detected: 0, matched: 0 };
    byType[exc.type]!.detected++;
  }

  const extraExceptions = detected.filter((exc) => !matchedKeys.has(detectedKey(exc)));

  const truePositives = matchedKeys.size;
  const falseNegatives = missedEntries.length;
  const falsePositives = detected.length - truePositives;

  return {
    totalGroundTruth: groundTruth.length,
    totalDetected: detected.length,
    truePositives,
    falsePositives,
    falseNegatives,
    precision: detected.length > 0 ? truePositives / detected.length : 1,
    recall: groundTruth.length > 0 ? truePositives / groundTruth.length : 1,
    missedEntries,
    extraExceptions,
    byType,
  };
}
