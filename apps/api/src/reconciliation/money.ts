/**
 * SettleGuard — Phase 2: money + date helpers for the reconciliation
 * engine. Same fee/tax policy as Day 2's generator, kept as a small
 * independent copy rather than a cross-package import — see Day 3's
 * note on why apps/api doesn't share code with scripts/ yet.
 */

const FEE_PERCENT = 0.02;
const GST_ON_FEE_PERCENT = 0.18;

export function calculateFeePaise(grossPaise: number): number {
  return Math.round(grossPaise * FEE_PERCENT);
}

export function calculateTaxPaise(feePaise: number): number {
  return Math.round(feePaise * GST_ON_FEE_PERCENT);
}

export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(dayIso: string, days: number): string {
  const d = new Date(`${dayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return dateOnly(d);
}

export function inr(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? "-" : "";
  return `${sign}\u20B9${Math.abs(rupees).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
