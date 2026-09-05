/**
 * Shared configuration, record, and ground-truth types for the SettleGuard
 * dataset generator.
 */

export type PaymentStatus = "captured" | "failed" | "pending";
export type PaymentMethod = "card" | "upi" | "netbanking" | "wallet";

export interface Payment {
  id: string;
  orderId: string;
  amountPaise: number;
  currency: "INR";
  status: PaymentStatus;
  capturedAt: string; // ISO timestamp
  method: PaymentMethod;
  merchantReference: string;
}

export interface Refund {
  id: string;
  paymentId: string;
  amountPaise: number;
  status: "processed";
  createdAt: string;
}

export interface Adjustment {
  id: string;
  settlementId: string;
  amountPaise: number; // negative = deduction
  type: string;
  description: string;
  sourceReference: string | null; // null = unexplained (injected)
}

export interface Settlement {
  id: string;
  dayBucket: string; // YYYY-MM-DD, the settlement's business day
  grossAmountPaise: number;
  feeAmountPaise: number; // as reported (may be wrong if feeMismatch injected)
  taxAmountPaise: number;
  adjustmentAmountPaise: number;
  reportedNetPaise: number;
  settledAt: string;
  bankReference: string;
}

export interface BankTransaction {
  id: string;
  settlementId: string; // ground-truth link — NOT necessarily recoverable from `reference` alone
  amountPaise: number; // may differ from settlement.reportedNetPaise if bankAmountMismatch injected
  direction: "credit";
  postedAt: string;
  reference: string; // may be garbled if ambiguousReference injected
  description: string;
}

export type ExceptionType =
  | "MISSING_SETTLEMENT"
  | "DUPLICATE_REFUND"
  | "FEE_MISMATCH"
  | "BANK_CREDIT_MISMATCH"
  | "UNKNOWN_ADJUSTMENT"
  | "AMBIGUOUS_MATCH";

export interface GroundTruthEntry {
  type: ExceptionType;
  recordIds: string[]; // every record touched by this injection
  amountAtRiskPaise: number;
  detail: Record<string, string | number | null>;
  note: string;
}

export interface ExceptionCounts {
  missingSettlement: number;
  duplicateRefund: number;
  feeMismatch: number;
  bankAmountMismatch: number;
  unknownAdjustment: number;
  ambiguousReference: number;
}

export interface DatasetConfig {
  name: string;
  seed: number;
  paymentCount: number;
  refundRate: number;
  daySpan: number; // payments spread across this many calendar days, starting baseDate
  baseDate: string; // YYYY-MM-DD
  exceptions: ExceptionCounts;
  outDir: string | null; // null = don't write files, console-report only
}

export interface GeneratedDataset {
  config: DatasetConfig;
  payments: Payment[];
  refunds: Refund[];
  settlements: Settlement[];
  bankTransactions: BankTransaction[];
  adjustments: Adjustment[];
  groundTruth: GroundTruthEntry[];
}
