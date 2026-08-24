
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
// ---------------- Raw data (populated by Day 3's ingestion) ----------------

export const merchants = pgTable("merchants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const batches = pgTable(
  "batches",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    status: text("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    recordCount: integer("record_count").notNull().default(0),
  },
  (table) => ({
    merchantNameUnique: uniqueIndex("batches_merchant_name_unique").on(
      table.merchantId,
      table.name,
    ),
  }),
);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batches.id),
  externalPaymentId: text("external_payment_id").notNull(),
  orderId: text("order_id"),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull(), // captured | failed | pending
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  method: text("method"),
  merchantReference: text("merchant_reference"),
  rawPayload: jsonb("raw_payload"),
});

export const refunds = pgTable("refunds", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batches.id),
  externalRefundId: text("external_refund_id").notNull(),
  paymentId: integer("payment_id").references(() => payments.id),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  status: text("status").notNull(), // processed | ...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  rawPayload: jsonb("raw_payload"),
});

export const settlements = pgTable("settlements", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batches.id),
  externalSettlementId: text("external_settlement_id").notNull(),
  grossAmountPaise: bigint("gross_amount_paise", { mode: "number" }).notNull(),
  feeAmountPaise: bigint("fee_amount_paise", { mode: "number" }).notNull(),
  taxAmountPaise: bigint("tax_amount_paise", { mode: "number" }).notNull(),
  adjustmentAmountPaise: bigint("adjustment_amount_paise", { mode: "number" }).notNull().default(0),
  expectedNetPaise: bigint("expected_net_paise", { mode: "number" }), // filled by Phase 2 step 8 (Day 4) — NULL until then
  reportedNetPaise: bigint("reported_net_paise", { mode: "number" }).notNull(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  bankReference: text("bank_reference"),
  rawPayload: jsonb("raw_payload"),
});

export const settlementItems = pgTable("settlement_items", {
  id: serial("id").primaryKey(),
  settlementId: integer("settlement_id").notNull().references(() => settlements.id),
  paymentId: integer("payment_id").references(() => payments.id),
  refundId: integer("refund_id").references(() => refunds.id),
  itemType: text("item_type").notNull(), // 'payment' | 'refund'
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
});

export const bankTransactions = pgTable("bank_transactions", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batches.id),
  externalBankId: text("external_bank_id").notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  direction: text("direction").notNull(), // credit | debit
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
  reference: text("reference"),
  description: text("description"),
  rawPayload: jsonb("raw_payload"),
});

export const adjustments = pgTable("adjustments", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batches.id),
  settlementId: integer("settlement_id").references(() => settlements.id),
  externalAdjustmentId: text("external_adjustment_id"),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  type: text("type"),
  description: text("description"),
  // Deliberate addition beyond §1.6's column list: the taxonomy's own
  // trigger for UNKNOWN_ADJUSTMENT is "not explained by any known
  // record" — this column is that link (a chargeback ID, a TDS filing
  // reference, etc.), NULL when genuinely unexplained. §1.6 says "a
  // practical schema could look like this," and every other exception
  // type maps cleanly onto existing columns except this one, which
  // needs somewhere to point.
  sourceReference: text("source_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------- Reconciliation output (Day 4 onward) ----------------

export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => batches.id),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalRecords: integer("total_records"),
  matchedRecords: integer("matched_records"),
  unmatchedRecords: integer("unmatched_records"),
  matchRate: real("match_rate"),
  exceptionCount: integer("exception_count"),
  autoResolvedCount: integer("auto_resolved_count"),
  humanReviewCount: integer("human_review_count"),
  unresolvedCount: integer("unresolved_count"),
});

export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => reconciliationRuns.id),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  matchType: text("match_type").notNull(), // stage_a | stage_b | stage_c
  score: integer("score"),
  status: text("status").notNull(),
  evidenceJson: jsonb("evidence_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exceptions = pgTable("exceptions", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => reconciliationRuns.id),
  type: text("type").notNull(),
  severity: text("severity").notNull(), // low | medium | high
  status: text("status").notNull().default("OPEN"),
  amountAtRiskPaise: bigint("amount_at_risk_paise", { mode: "number" }).notNull(),
  primaryRecordType: text("primary_record_type"),
  primaryRecordId: integer("primary_record_id"),
  summary: text("summary"),
  deterministicEvidenceJson: jsonb("deterministic_evidence_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const investigations = pgTable("investigations", {
  id: serial("id").primaryKey(),
  exceptionId: integer("exception_id").notNull().references(() => exceptions.id),
  status: text("status").notNull().default("pending"),
  model: text("model"),
  promptVersion: text("prompt_version"),
  rootCause: text("root_cause"),
  confidence: real("confidence"),
  recommendedAction: text("recommended_action"),
  requiresHumanApproval: boolean("requires_human_approval").notNull().default(true),
  structuredOutputJson: jsonb("structured_output_json"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const agentEvents = pgTable("agent_events", {
  id: serial("id").primaryKey(),
  investigationId: integer("investigation_id").notNull().references(() => investigations.id),
  sequenceNumber: integer("sequence_number").notNull(),
  eventType: text("event_type").notNull(),
  toolName: text("tool_name"),
  toolInputJson: jsonb("tool_input_json"),
  toolOutputJson: jsonb("tool_output_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewCases = pgTable("review_cases", {
  id: serial("id").primaryKey(),
  exceptionId: integer("exception_id").notNull().references(() => exceptions.id),
  status: text("status").notNull().default("pending"),
  proposedAction: text("proposed_action"),
  reviewerDecision: text("reviewer_decision"),
  reviewerNote: text("reviewer_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorType: text("actor_type").notNull(), // human | agent | system
  actorId: text("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  beforeJson: jsonb("before_json"),
  afterJson: jsonb("after_json"),
  metadataJson: jsonb("metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});


export type PaymentRecord = typeof payments.$inferSelect;
export type RefundRecord = typeof refunds.$inferSelect;
export type SettlementRecord = typeof settlements.$inferSelect;
export type BankTransactionRecord = typeof bankTransactions.$inferSelect;
export type AdjustmentRecord = typeof adjustments.$inferSelect;
export type SettlementItemRecord = typeof settlementItems.$inferSelect;
export type ExceptionRecord = typeof exceptions.$inferSelect;
export type MatchRecord = typeof matches.$inferSelect;
