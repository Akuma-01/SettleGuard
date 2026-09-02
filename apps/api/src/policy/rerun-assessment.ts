/** Determine whether a fresh reconciliation run actually cleared an exception. */
import type { ExceptionRecord } from "../db/schema.js";

export type RerunAssessment =
  | { outcome: "cleared"; relatedExceptionIds: [] }
  | { outcome: "persisted"; relatedExceptionIds: number[] }
  | { outcome: "changed"; relatedExceptionIds: number[]; replacementTypes: string[] }
  | { outcome: "indeterminate"; relatedExceptionIds: []; reason: "PRIMARY_RECORD_IDENTITY_MISSING" };

function sortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

/**
 * Compare only exceptions produced by the specified fresh run and only against
 * the original trusted primary-record identity. Absence is proof of clearance;
 * a new class on the same record requires review rather than silent resolution.
 */
export function assessRerun(
  original: ExceptionRecord,
  rerunId: number,
  candidates: ExceptionRecord[],
): RerunAssessment {
  if (!Number.isInteger(rerunId) || rerunId <= 0) throw new Error("rerunId must be a positive integer");
  if (rerunId === original.runId) throw new Error("rerunId must identify a fresh reconciliation run");
  if (!original.primaryRecordType || original.primaryRecordId === null) {
    return { outcome: "indeterminate", relatedExceptionIds: [], reason: "PRIMARY_RECORD_IDENTITY_MISSING" };
  }

  const related = candidates.filter((candidate) =>
    candidate.runId === rerunId
    && candidate.primaryRecordType === original.primaryRecordType
    && candidate.primaryRecordId === original.primaryRecordId,
  );
  const persistent = related.filter((candidate) => candidate.type === original.type);
  if (persistent.length > 0) {
    return { outcome: "persisted", relatedExceptionIds: sortedUnique(persistent.map((candidate) => candidate.id)) };
  }
  if (related.length > 0) {
    return {
      outcome: "changed",
      relatedExceptionIds: sortedUnique(related.map((candidate) => candidate.id)),
      replacementTypes: [...new Set(related.map((candidate) => candidate.type))].sort(),
    };
  }
  return { outcome: "cleared", relatedExceptionIds: [] };
}
