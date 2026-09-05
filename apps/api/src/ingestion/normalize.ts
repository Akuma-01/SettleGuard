/**
 * SettleGuard ingestion normalization.
 *
 * Deliberately separate from validation (schemas.ts). Validation asks
 * "is this well-formed input"; normalization asks "what's the
 * canonical internal value". Two different jobs, two different files,
 * so a change to one doesn't quietly change the other's behavior.
 */

/** "1234.56" -> 123456. "-500.00" -> -50000. Never touches a float. */
export function rupeeStringToPaise(amount: string): number {
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [rupees, paise] = unsigned.split(".");
  if (rupees === undefined || paise === undefined || paise.length !== 2 || !/^\d+$/.test(rupees) || !/^\d{2}$/.test(paise)) {
    throw new Error(`rupeeStringToPaise: "${amount}" is not a clean 2-decimal amount`);
  }
  const total = parseInt(rupees, 10) * 100 + parseInt(paise, 10);
  return negative ? -total : total;
}

/** CSV empty string represents "no value" — normalize to null, not "". */
export function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/** Timestamps are already ISO UTC from the generator; this just makes the intent explicit and gives one place to harden later against other real-world formats (e.g. "05/03/2026 2:23 PM IST"). */
export function normalizeTimestamp(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`normalizeTimestamp: "${value}" is not a parseable timestamp`);
  }
  return d;
}

/** Status strings are lowercased and trimmed — cheap insurance against "Captured" vs "captured" from a different export source later. */
export function normalizeStatus(value: string): string {
  return value.trim().toLowerCase();
}
