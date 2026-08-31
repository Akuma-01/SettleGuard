/** SettleGuard's read-only, input-validated evidence boundary for the agent. */
import { and, eq, gte, ilike, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { adjustments, bankTransactions, exceptions, payments, refunds, settlementItems, settlements } from "../db/schema.js";
import { analysisToolDefinitions, analysisToolNames, executeAnalysisTool } from "./analysis-tools.js";

export interface ToolProperty {
  type: "integer" | "string" | "array";
  description: string;
  items?: { type: "integer" | "string" };
}
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, ToolProperty>; required: string[]; additionalProperties?: false };
}

const idProperty = (description: string): ToolProperty => ({ type: "integer", description });
function defineTool(name: string, description: string, properties: Record<string, ToolProperty>): ToolDefinition {
  return { name, description, input_schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } };
}

const evidenceToolDefinitions: ToolDefinition[] = [
  defineTool("get_exception", "Fetch the exception under investigation, including deterministic evidence already gathered.", { exceptionId: idProperty("Internal exceptions.id") }),
  defineTool("get_payment", "Fetch one payment record by its internal ID.", { paymentId: idProperty("Internal payments.id") }),
  defineTool("get_refund", "Fetch one refund record by its internal ID.", { refundId: idProperty("Internal refunds.id") }),
  defineTool("get_settlement", "Fetch one settlement, including expected and reported amounts and its bank reference.", { settlementId: idProperty("Internal settlements.id") }),
  defineTool("get_bank_transaction", "Fetch one bank transaction by its internal ID.", { bankTransactionId: idProperty("Internal bank_transactions.id") }),
  defineTool("get_adjustment", "Fetch one adjustment, including its source reference when one exists.", { adjustmentId: idProperty("Internal adjustments.id") }),
  defineTool("get_adjustments", "Fetch all adjustments attached to a settlement.", { settlementId: idProperty("Internal settlements.id") }),
  defineTool("get_related_payments", "Fetch all payments confirmed as settlement items for a settlement.", { settlementId: idProperty("Internal settlements.id") }),
  defineTool("get_related_refunds", "Fetch all refunds confirmed as settlement items for a settlement.", { settlementId: idProperty("Internal settlements.id") }),
  {
    name: "find_bank_credits",
    description: "Find credit-side bank transactions by exact amount in an inclusive date range, optionally narrowing by a partial reference.",
    input_schema: {
      type: "object",
      properties: {
        amountPaise: { type: "integer", description: "Exact positive credit amount in paise" },
        startDate: { type: "string", description: "Inclusive ISO-8601 date or timestamp" },
        endDate: { type: "string", description: "Inclusive ISO-8601 date or timestamp" },
        reference: { type: "string", description: "Optional case-insensitive partial bank reference" },
      },
      required: ["amountPaise", "startDate", "endDate"],
      additionalProperties: false,
    },
  },
];

export const toolDefinitions: ToolDefinition[] = [...evidenceToolDefinitions, ...analysisToolDefinitions];

const positiveId = z.number().int().positive();
const idSchemas = {
  get_exception: z.object({ exceptionId: positiveId }).strict(),
  get_payment: z.object({ paymentId: positiveId }).strict(),
  get_refund: z.object({ refundId: positiveId }).strict(),
  get_settlement: z.object({ settlementId: positiveId }).strict(),
  get_bank_transaction: z.object({ bankTransactionId: positiveId }).strict(),
  get_adjustment: z.object({ adjustmentId: positiveId }).strict(),
  get_adjustments: z.object({ settlementId: positiveId }).strict(),
  get_related_payments: z.object({ settlementId: positiveId }).strict(),
  get_related_refunds: z.object({ settlementId: positiveId }).strict(),
} as const;

const bankCreditSearchSchema = z.object({
  amountPaise: z.number().int().positive(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reference: z.string().trim().min(1).optional(),
}).strict().transform((input, ctx) => {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "startDate and endDate must be valid ISO-8601 values" });
    return z.NEVER;
  }
  if (startDate > endDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "startDate must not be after endDate" });
    return z.NEVER;
  }
  return { ...input, startDate, endDate };
});

async function getById(table: any, id: number, label: string) {
  const [row] = await db.select().from(table).where(eq(table.id, id));
  return row ?? { error: `No ${label} with id ${id}` };
}

async function getRelatedPayments(settlementId: number) {
  const items = await db.select().from(settlementItems).where(eq(settlementItems.settlementId, settlementId));
  const ids = items.flatMap((item) => item.itemType === "payment" && item.paymentId !== null ? [item.paymentId] : []);
  return { payments: ids.length === 0 ? [] : await db.select().from(payments).where(inArray(payments.id, ids)) };
}

async function getRelatedRefunds(settlementId: number) {
  const items = await db.select().from(settlementItems).where(eq(settlementItems.settlementId, settlementId));
  const ids = items.flatMap((item) => item.itemType === "refund" && item.refundId !== null ? [item.refundId] : []);
  return { refunds: ids.length === 0 ? [] : await db.select().from(refunds).where(inArray(refunds.id, ids)) };
}

async function findBankCredits(input: z.output<typeof bankCreditSearchSchema>) {
  const filters = [
    eq(bankTransactions.direction, "credit"),
    eq(bankTransactions.amountPaise, input.amountPaise),
    gte(bankTransactions.postedAt, input.startDate),
    lte(bankTransactions.postedAt, input.endDate),
  ];
  if (input.reference) filters.push(ilike(bankTransactions.reference, `%${input.reference}%`));
  return { bankTransactions: await db.select().from(bankTransactions).where(and(...filters)) };
}

function invalidInput(error: z.ZodError) {
  return { error: "Invalid tool input", details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (analysisToolNames.has(name)) return executeAnalysisTool(name, input);
  if (name === "find_bank_credits") {
    const parsed = bankCreditSearchSchema.safeParse(input);
    return parsed.success ? findBankCredits(parsed.data) : invalidInput(parsed.error);
  }
  const schema = idSchemas[name as keyof typeof idSchemas];
  if (!schema) return { error: `Unknown tool: ${name}` };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const data = parsed.data as Record<string, number>;

  switch (name) {
    case "get_exception": return getById(exceptions, data.exceptionId!, "exception");
    case "get_payment": return getById(payments, data.paymentId!, "payment");
    case "get_refund": return getById(refunds, data.refundId!, "refund");
    case "get_settlement": return getById(settlements, data.settlementId!, "settlement");
    case "get_bank_transaction": return getById(bankTransactions, data.bankTransactionId!, "bank transaction");
    case "get_adjustment": return getById(adjustments, data.adjustmentId!, "adjustment");
    case "get_adjustments": return { adjustments: await db.select().from(adjustments).where(eq(adjustments.settlementId, data.settlementId!)) };
    case "get_related_payments": return getRelatedPayments(data.settlementId!);
    case "get_related_refunds": return getRelatedRefunds(data.settlementId!);
  }
}
