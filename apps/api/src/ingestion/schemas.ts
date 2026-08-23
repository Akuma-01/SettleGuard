/**
 * SettleGuard — Phase 2, Step 3: CSV row validation.
 *
 * One schema per entity, matching the exact column headers Day 2's
 * generator writes. Amounts are validated as decimal-rupee STRINGS
 * here (CSV has no native number type) — converting them to integer
 * paise is normalize.ts's job (step 4), deliberately kept separate
 * from validation (step 3) so each step does one thing.
 */

import { z } from "zod";

// Decimal rupees as written by the generator: "1234.56" or "-1234.56".
// Reject anything that isn't a clean 2-decimal amount — a real export
// with "₹1,234.56" or "1234.5" or empty string should fail loudly here,
// not silently become 0 downstream.
const decimalAmount = z
  .string()
  .regex(/^-?\d+\.\d{2}$/, "amount must be a plain decimal with exactly 2 places, e.g. 1234.56");

// A payment, refund, or bank credit amount should never be negative —
// sign/direction is carried by other fields (bank_transactions.direction),
// not by the amount itself. Settlement fee/tax/adjustment/net and
// adjustments.amount reuse the plain decimalAmount above since those
// legitimately can be negative (a deduction, a net loss day).
const positiveDecimalAmount = decimalAmount.refine((v) => !v.startsWith("-"), {
  message: "amount must not be negative",
});

const isoTimestamp = z.string().datetime({ message: "must be an ISO 8601 UTC timestamp, e.g. 2026-03-05T14:23:00Z" });

const nonEmptyId = z.string().min(1, "id must not be empty");

export const paymentRowSchema = z.object({
  payment_id: nonEmptyId,
  order_id: z.string(),
  amount: positiveDecimalAmount,
  currency: z.enum(["INR"]),
  status: z.enum(["captured", "failed", "pending"]),
  captured_at: isoTimestamp,
  method: z.enum(["card", "upi", "netbanking", "wallet"]),
  merchant_reference: z.string(),
});
export type PaymentRow = z.infer<typeof paymentRowSchema>;

export const refundRowSchema = z.object({
  refund_id: nonEmptyId,
  payment_id: nonEmptyId,
  amount: positiveDecimalAmount,
  status: z.enum(["processed", "pending", "failed"]),
  created_at: isoTimestamp,
});
export type RefundRow = z.infer<typeof refundRowSchema>;

export const settlementRowSchema = z.object({
  settlement_id: nonEmptyId,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD"),
  gross_amount: decimalAmount,
  fee_amount: decimalAmount,
  tax_amount: decimalAmount,
  adjustment_amount: decimalAmount,
  net_amount: decimalAmount,
  settled_at: isoTimestamp,
  bank_reference: z.string(),
});
export type SettlementRow = z.infer<typeof settlementRowSchema>;

// Deliberately NO settlement_id field — see Day 2's note on
// bank_transactions.csv. This schema validates exactly what a real
// bank statement line would actually contain.
export const bankTransactionRowSchema = z.object({
  bank_transaction_id: nonEmptyId,
  amount: positiveDecimalAmount,
  direction: z.enum(["credit", "debit"]),
  posted_at: isoTimestamp,
  reference: z.string(),
  description: z.string(),
});
export type BankTransactionRow = z.infer<typeof bankTransactionRowSchema>;

export const adjustmentRowSchema = z.object({
  adjustment_id: nonEmptyId,
  settlement_id: nonEmptyId,
  amount: decimalAmount,
  type: z.string(),
  description: z.string(),
  source_reference: z.string(), // "" means unexplained — normalize.ts maps "" -> null
});
export type AdjustmentRow = z.infer<typeof adjustmentRowSchema>;
