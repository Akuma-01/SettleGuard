/** Pure/deterministic financial analysis tools. None of these functions write. */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { adjustments, bankTransactions, payments, settlementItems, settlements } from "../db/schema.js";
import { calculateFeePaise, calculateTaxPaise } from "../reconciliation/money.js";
import type { ToolDefinition } from "./tools.js";

export const analysisToolDefinitions: ToolDefinition[] = [
  {
    name: "calculate_expected_settlement",
    description: "Recalculate a settlement's expected net from confirmed settlement items and explained adjustments using deterministic fee and tax policy.",
    input_schema: {
      type: "object",
      properties: { settlementId: { type: "integer", description: "Internal settlements.id" } },
      required: ["settlementId"],
      additionalProperties: false,
    },
  },
  {
    name: "calculate_expected_fees",
    description: "Calculate expected processing fee and GST from an explicit set of payment IDs using deterministic policy.",
    input_schema: {
      type: "object",
      properties: {
        paymentIds: {
          type: "array",
          description: "One or more internal payments.id values",
          items: { type: "integer" },
        },
      },
      required: ["paymentIds"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_settlement_to_bank",
    description: "Compare a settlement with credit-side bank transactions carrying its exact bank reference and return deterministic amount deltas.",
    input_schema: {
      type: "object",
      properties: { settlementId: { type: "integer", description: "Internal settlements.id" } },
      required: ["settlementId"],
      additionalProperties: false,
    },
  },
  {
    name: "score_candidate_match",
    description: "Score one settlement/bank-credit candidate using exact reference, exact amount, and a three-day date window. Returns criteria, not a decision.",
    input_schema: {
      type: "object",
      properties: {
        settlementId: { type: "integer", description: "Internal settlements.id" },
        bankTransactionId: { type: "integer", description: "Internal bank_transactions.id" },
      },
      required: ["settlementId", "bankTransactionId"],
      additionalProperties: false,
    },
  },
];

export const analysisToolNames = new Set(analysisToolDefinitions.map((tool) => tool.name));

const id = z.number().int().positive();
const settlementInput = z.object({ settlementId: id }).strict();
const feeInput = z.object({ paymentIds: z.array(id).min(1).max(1_000) }).strict();
const candidateInput = z.object({ settlementId: id, bankTransactionId: id }).strict();

function invalidInput(error: z.ZodError) {
  return { error: "Invalid tool input", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
}

async function calculateExpectedSettlement(settlementId: number) {
  const [settlement] = await db.select().from(settlements).where(eq(settlements.id, settlementId));
  if (!settlement) return { error: `No settlement with id ${settlementId}` };

  const [items, settlementAdjustments] = await Promise.all([
    db.select().from(settlementItems).where(eq(settlementItems.settlementId, settlementId)),
    db.select().from(adjustments).where(eq(adjustments.settlementId, settlementId)),
  ]);
  // settlement_items currently has no run_id, so an explicit reconciliation
  // rerun can leave duplicate links. De-duplicate by the linked source ID to
  // keep this calculation stable and avoid double-counting money.
  const paymentItems = new Map(items.flatMap((item) => item.paymentId === null ? [] : [[item.paymentId, item] as const]));
  const refundItems = new Map(items.flatMap((item) => item.refundId === null ? [] : [[item.refundId, item] as const]));
  const grossPaise = [...paymentItems.values()].reduce((sum, item) => sum + item.amountPaise, 0);
  const refundPaise = [...refundItems.values()].reduce((sum, item) => sum + item.amountPaise, 0);
  const feePaise = calculateFeePaise(grossPaise);
  const taxPaise = calculateTaxPaise(feePaise);
  const explainedAdjustmentPaise = settlementAdjustments
    .filter((adjustment) => adjustment.sourceReference !== null)
    .reduce((sum, adjustment) => sum + adjustment.amountPaise, 0);
  const expectedNetPaise = grossPaise - refundPaise - feePaise - taxPaise + explainedAdjustmentPaise;

  return {
    settlementId,
    grossPaise,
    refundPaise,
    feePaise,
    taxPaise,
    explainedAdjustmentPaise,
    expectedNetPaise,
    storedExpectedNetPaise: settlement.expectedNetPaise,
    agreesWithStoredValue: settlement.expectedNetPaise === expectedNetPaise,
  };
}

async function calculateExpectedFees(paymentIds: number[]) {
  const uniqueIds = [...new Set(paymentIds)];
  const rows = await db.select().from(payments).where(inArray(payments.id, uniqueIds));
  const foundIds = new Set(rows.map((payment) => payment.id));
  const missingPaymentIds = uniqueIds.filter((paymentId) => !foundIds.has(paymentId));
  if (missingPaymentIds.length > 0) return { error: "One or more payments were not found", missingPaymentIds };
  const grossPaise = rows.reduce((sum, payment) => sum + payment.amountPaise, 0);
  const feePaise = calculateFeePaise(grossPaise);
  return { paymentIds: uniqueIds, grossPaise, feePaise, taxPaise: calculateTaxPaise(feePaise) };
}

async function compareSettlementToBank(settlementId: number) {
  const [settlement] = await db.select().from(settlements).where(eq(settlements.id, settlementId));
  if (!settlement) return { error: `No settlement with id ${settlementId}` };
  if (!settlement.bankReference) return { settlementId, expectedNetPaise: settlement.expectedNetPaise, matches: [], reason: "Settlement has no bank reference" };

  const credits = await db.select().from(bankTransactions).where(and(
    eq(bankTransactions.batchId, settlement.batchId),
    eq(bankTransactions.direction, "credit"),
    eq(bankTransactions.reference, settlement.bankReference),
  ));
  const expectedNetPaise = settlement.expectedNetPaise ?? settlement.reportedNetPaise;
  return {
    settlementId,
    bankReference: settlement.bankReference,
    expectedNetPaise,
    matches: credits.map((credit) => ({
      bankTransactionId: credit.id,
      amountPaise: credit.amountPaise,
      deltaPaise: credit.amountPaise - expectedNetPaise,
      amountMatches: credit.amountPaise === expectedNetPaise,
    })),
  };
}

async function scoreCandidateMatch(settlementId: number, bankTransactionId: number) {
  const [[settlement], [bankTransaction]] = await Promise.all([
    db.select().from(settlements).where(eq(settlements.id, settlementId)),
    db.select().from(bankTransactions).where(eq(bankTransactions.id, bankTransactionId)),
  ]);
  if (!settlement) return { error: `No settlement with id ${settlementId}` };
  if (!bankTransaction) return { error: `No bank transaction with id ${bankTransactionId}` };

  const referenceMatch = Boolean(settlement.bankReference && bankTransaction.reference === settlement.bankReference);
  const amountMatch = bankTransaction.amountPaise === settlement.reportedNetPaise;
  const dateDifferenceDays = settlement.settledAt
    ? Math.abs(bankTransaction.postedAt.getTime() - settlement.settledAt.getTime()) / 86_400_000
    : null;
  const withinDateWindow = dateDifferenceDays !== null && dateDifferenceDays <= 3;
  const sameBatch = settlement.batchId === bankTransaction.batchId;
  const creditDirection = bankTransaction.direction === "credit";
  const score = sameBatch && creditDirection
    ? (referenceMatch ? 25 : 0) + (amountMatch ? 50 : 0) + (withinDateWindow ? 25 : 0)
    : 0;

  return { settlementId, bankTransactionId, score, criteria: { sameBatch, creditDirection, referenceMatch, amountMatch, withinDateWindow, dateDifferenceDays } };
}

export async function executeAnalysisTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === "calculate_expected_fees") {
    const parsed = feeInput.safeParse(input);
    return parsed.success ? calculateExpectedFees(parsed.data.paymentIds) : invalidInput(parsed.error);
  }
  if (name === "score_candidate_match") {
    const parsed = candidateInput.safeParse(input);
    return parsed.success ? scoreCandidateMatch(parsed.data.settlementId, parsed.data.bankTransactionId) : invalidInput(parsed.error);
  }
  const parsed = settlementInput.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  if (name === "calculate_expected_settlement") return calculateExpectedSettlement(parsed.data.settlementId);
  if (name === "compare_settlement_to_bank") return compareSettlementToBank(parsed.data.settlementId);
  return { error: `Unknown analysis tool: ${name}` };
}
