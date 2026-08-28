/**
 * SettleGuard — Phase 4, Step 2 (partial): the tool layer.
 *
 * Deliberately a small slice of the full catalog the architecture doc
 * describes (§1.9) — five read-only evidence tools, enough to
 * investigate one UNKNOWN_ADJUSTMENT end to end. No analysis tools,
 * no controlled-action tools yet: those are Day 7-8's "build out the
 * tool layer" step, once the vertical slice proves the wiring works.
 *
 * No tool here writes anything or moves money — every one is a
 * read-only SELECT. The agent recommends; it doesn't decide or act.
 * That boundary is enforced by what tools exist, not by a system
 * prompt asking nicely.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { adjustments, exceptions, payments, refunds, settlementItems, settlements } from "../db/schema.js";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: "get_exception",
    description: "Fetch the exception record under investigation, including its type, severity, amount at risk, and the deterministic evidence the reconciliation engine already gathered.",
    input_schema: {
      type: "object",
      properties: { exceptionId: { type: "integer", description: "Internal exceptions.id" } },
      required: ["exceptionId"],
    },
  },
  {
    name: "get_settlement",
    description: "Fetch a settlement's full record: gross/fee/tax/adjustment amounts, expected vs reported net, settled date, and bank reference.",
    input_schema: {
      type: "object",
      properties: { settlementId: { type: "integer", description: "Internal settlements.id" } },
      required: ["settlementId"],
    },
  },
  {
    name: "get_adjustment",
    description: "Fetch an adjustment's full record: amount, type, description, and source_reference (null means unexplained — that's the whole question this tool exists to check).",
    input_schema: {
      type: "object",
      properties: { adjustmentId: { type: "integer", description: "Internal adjustments.id" } },
      required: ["adjustmentId"],
    },
  },
  {
    name: "get_related_payments",
    description: "Fetch every payment confirmed as part of a settlement (via settlement_items), so the agent can check whether the adjustment amount, or a close variant of it, corresponds to anything in that settlement's own payment activity.",
    input_schema: {
      type: "object",
      properties: { settlementId: { type: "integer", description: "Internal settlements.id" } },
      required: ["settlementId"],
    },
  },
  {
    name: "get_related_refunds",
    description: "Fetch every refund confirmed as part of a settlement (via settlement_items), for the same reason as get_related_payments — refunds are a common real-world source of small unexplained deductions.",
    input_schema: {
      type: "object",
      properties: { settlementId: { type: "integer", description: "Internal settlements.id" } },
      required: ["settlementId"],
    },
  },
];

async function getException(exceptionId: number) {
  const [row] = await db.select().from(exceptions).where(eq(exceptions.id, exceptionId));
  if (!row) return { error: `No exception with id ${exceptionId}` };
  return row;
}

async function getSettlement(settlementId: number) {
  const [row] = await db.select().from(settlements).where(eq(settlements.id, settlementId));
  if (!row) return { error: `No settlement with id ${settlementId}` };
  return row;
}

async function getAdjustment(adjustmentId: number) {
  const [row] = await db.select().from(adjustments).where(eq(adjustments.id, adjustmentId));
  if (!row) return { error: `No adjustment with id ${adjustmentId}` };
  return row;
}

async function getRelatedPayments(settlementId: number) {
  const items = await db.select().from(settlementItems).where(eq(settlementItems.settlementId, settlementId));
  const paymentIds = items.filter((i) => i.itemType === "payment" && i.paymentId !== null).map((i) => i.paymentId as number);
  if (paymentIds.length === 0) return { payments: [] };
  const rows = await Promise.all(paymentIds.map((id) => db.select().from(payments).where(eq(payments.id, id))));
  return { payments: rows.flat() };
}

async function getRelatedRefunds(settlementId: number) {
  const items = await db.select().from(settlementItems).where(eq(settlementItems.settlementId, settlementId));
  const refundIds = items.filter((i) => i.itemType === "refund" && i.refundId !== null).map((i) => i.refundId as number);
  if (refundIds.length === 0) return { refunds: [] };
  const rows = await Promise.all(refundIds.map((id) => db.select().from(refunds).where(eq(refunds.id, id))));
  return { refunds: rows.flat() };
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_exception":
      return getException(input.exceptionId as number);
    case "get_settlement":
      return getSettlement(input.settlementId as number);
    case "get_adjustment":
      return getAdjustment(input.adjustmentId as number);
    case "get_related_payments":
      return getRelatedPayments(input.settlementId as number);
    case "get_related_refunds":
      return getRelatedRefunds(input.settlementId as number);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
