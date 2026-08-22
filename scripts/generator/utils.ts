/**
 * SettleGuard — Phase 1, Step 2: shared utilities.
 * Same mulberry32 seeded RNG as Day 1's proof script, extracted so
 * every generator module (and Phase 2+ later) can share one source
 * of truth instead of redefining it.
 */

export function mulberry32(seed: number) {
  let a = seed;
  return function rand(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- Money ----------------
// Integer paise everywhere internally. Two output formats:
//   inr()            human-readable, for console reports (₹1,234.56)
//   toRupeeString()   plain decimal, for CSV files (1234.56) — CSVs
//                     simulate a real-world export, so amounts are
//                     rupee decimals, NOT paise. Normalizing that back
//                     to integer paise is Phase 2's job, on purpose.

export function inr(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? "-" : "";
  return `${sign}\u20B9${Math.abs(rupees).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function toRupeeString(paise: number): string {
  return (paise / 100).toFixed(2);
}

const FEE_PERCENT = 0.02;
const GST_ON_FEE_PERCENT = 0.18;

export function calculateFeePaise(amountPaise: number): number {
  return Math.round(amountPaise * FEE_PERCENT);
}
export function calculateTaxPaise(feePaise: number): number {
  return Math.round(feePaise * GST_ON_FEE_PERCENT);
}

// ---------------- Dates ----------------
// Day-bucketed so settlement grouping is a natural business concept
// (one settlement per day with captured payments) rather than an
// arbitrary record-count split.

export function addDays(baseDateISO: string, days: number): Date {
  const d = new Date(`${baseDateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function dayBucket(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function atTime(dayISO: string, hh: number, mm: number): string {
  return `${dayISO}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`;
}
