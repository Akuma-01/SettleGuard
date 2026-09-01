/** Extract canonical internal record IDs from verified tool observations. */
import type { AgentStep } from "./loop.js";

const toolRecordTypes: Record<string, string> = {
  get_exception: "exception",
  get_payment: "payment",
  get_refund: "refund",
  get_settlement: "settlement",
  get_bank_transaction: "bank_transaction",
  get_adjustment: "adjustment",
};

const keyRecordTypes: Record<string, string> = {
  exceptionId: "exception",
  paymentId: "payment",
  paymentIds: "payment",
  refundId: "refund",
  refundIds: "refund",
  settlementId: "settlement",
  settlementIds: "settlement",
  bankTransactionId: "bank_transaction",
  bankTransactionIds: "bank_transaction",
  adjustmentId: "adjustment",
  adjustmentIds: "adjustment",
};

const collectionRecordTypes: Record<string, string> = {
  payments: "payment",
  refunds: "refund",
  settlements: "settlement",
  bankTransactions: "bank_transaction",
  adjustments: "adjustment",
};

function addId(ids: Set<string>, recordType: string, value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) ids.add(`${recordType}:${value}`);
}

function visit(value: unknown, ids: Set<string>, contextualType?: string): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, ids, contextualType);
    return;
  }
  if (!value || typeof value !== "object") {
    if (contextualType) addId(ids, contextualType, value);
    return;
  }

  const object = value as Record<string, unknown>;
  if (contextualType) addId(ids, contextualType, object.id);
  if (typeof object.primaryRecordType === "string") addId(ids, object.primaryRecordType, object.primaryRecordId);

  for (const [key, child] of Object.entries(object)) {
    const recordType = keyRecordTypes[key];
    if (recordType) {
      if (Array.isArray(child)) for (const id of child) addId(ids, recordType, id);
      else addId(ids, recordType, child);
    }
    visit(child, ids, collectionRecordTypes[key]);
  }
}

export function extractObservedRecordIds(steps: AgentStep[]): Set<string> {
  const ids = new Set<string>();
  for (const step of steps) {
    if (step.type !== "tool_result") continue;
    visit(step.toolOutput, ids, toolRecordTypes[step.toolName]);
  }
  return ids;
}
