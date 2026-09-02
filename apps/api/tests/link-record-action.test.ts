import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { auditLogs, bankTransactions, batches, exceptions, matches, merchants, reconciliationRuns, settlements } from "../src/db/schema.js";
import { executeLinkRecordAction, type LinkRecordAuthorization } from "../src/policy/link-record-action.js";

let runId: number;
let exceptionId: number;
let bankTransactionId: number;
let settlementId: number;
let conflictingExceptionId: number;
let conflictingBankId: number;

const authorization: LinkRecordAuthorization = {
  actorType: "human",
  actorId: "reviewer-42",
  reason: "Verified the gateway reference against the bank statement",
};

beforeAll(async () => {
  let [merchant] = await db.select().from(merchants).limit(1);
  if (!merchant) [merchant] = await db.insert(merchants).values({ name: "Link Action Test" }).returning();
  const [batch] = await db.insert(batches).values({
    merchantId: merchant!.id,
    name: `link-action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "completed",
  }).returning();
  const [run] = await db.insert(reconciliationRuns).values({ batchId: batch!.id, status: "completed" }).returning();
  runId = run!.id;

  const createdSettlements = await db.insert(settlements).values([
    {
      batchId: batch!.id,
      externalSettlementId: "link-target",
      grossAmountPaise: 10_000,
      feeAmountPaise: 200,
      taxAmountPaise: 36,
      adjustmentAmountPaise: 0,
      reportedNetPaise: 9_764,
      bankReference: "BANK-LINK",
    },
    {
      batchId: batch!.id,
      externalSettlementId: "conflicting-target",
      grossAmountPaise: 10_000,
      feeAmountPaise: 200,
      taxAmountPaise: 36,
      adjustmentAmountPaise: 0,
      reportedNetPaise: 9_764,
      bankReference: "BANK-CONFLICT",
    },
  ]).returning();
  settlementId = createdSettlements[0]!.id;

  const createdBanks = await db.insert(bankTransactions).values([
    {
      batchId: batch!.id,
      externalBankId: "link-source",
      amountPaise: 9_764,
      direction: "credit",
      postedAt: new Date(),
      reference: "BANK-LINK",
    },
    {
      batchId: batch!.id,
      externalBankId: "conflicting-source",
      amountPaise: 9_764,
      direction: "credit",
      postedAt: new Date(),
      reference: "BANK-CONFLICT",
    },
  ]).returning();
  bankTransactionId = createdBanks[0]!.id;
  conflictingBankId = createdBanks[1]!.id;

  const createdExceptions = await db.insert(exceptions).values([
    {
      runId,
      type: "AMBIGUOUS_MATCH",
      severity: "medium",
      status: "OPEN",
      amountAtRiskPaise: 9_764,
      primaryRecordType: "bank_transaction",
      primaryRecordId: bankTransactionId,
      deterministicEvidenceJson: { bankTransactionId, settlementId },
    },
    {
      runId,
      type: "AMBIGUOUS_MATCH",
      severity: "medium",
      status: "OPEN",
      amountAtRiskPaise: 9_764,
      primaryRecordType: "bank_transaction",
      primaryRecordId: conflictingBankId,
      deterministicEvidenceJson: { bankTransactionId: conflictingBankId, settlementId },
    },
  ]).returning();
  exceptionId = createdExceptions[0]!.id;
  conflictingExceptionId = createdExceptions[1]!.id;

  await db.insert(matches).values({
    runId,
    sourceType: "bank_transaction",
    sourceId: conflictingBankId,
    targetType: "settlement",
    targetId: createdSettlements[1]!.id,
    matchType: "stage_c",
    score: 80,
    status: "matched",
  });
});

describe("executeLinkRecordAction", () => {
  it("denies link mutation without explicit human authorization", async () => {
    const result = await executeLinkRecordAction({
      action: "link_record",
      exceptionId,
      sourceType: "bank_transaction",
      sourceId: bankTransactionId,
      targetType: "settlement",
      targetId: settlementId,
    });
    expect(result).toEqual({ status: "denied", reason: "HUMAN_AUTHORIZATION_REQUIRED" });
  });

  it("creates an evidence-bound link, resolves the exception, and audits the reviewer", async () => {
    const result = await executeLinkRecordAction({
      action: "link_record",
      exceptionId,
      sourceType: "bank_transaction",
      sourceId: bankTransactionId,
      targetType: "settlement",
      targetId: settlementId,
    }, authorization);

    expect(result).toMatchObject({ status: "linked", created: true, exceptionResolved: true });
    if (result.status !== "linked") throw new Error("Expected linked result");
    const [exception] = await db.select().from(exceptions).where(eq(exceptions.id, exceptionId));
    expect(exception).toMatchObject({ status: "HUMAN_RESOLVED" });
    const [audit] = await db.select().from(auditLogs).where(and(
      eq(auditLogs.entityType, "exception"),
      eq(auditLogs.entityId, exceptionId),
      eq(auditLogs.action, "link_record"),
    ));
    expect(audit).toMatchObject({ actorType: "human", actorId: authorization.actorId });
    expect(audit!.afterJson).toMatchObject({ status: "HUMAN_RESOLVED", matchId: result.matchId });
  });

  it("reuses the exact link on retry without resolving twice", async () => {
    const before = await db.select().from(matches).where(and(eq(matches.runId, runId), eq(matches.sourceId, bankTransactionId)));
    const result = await executeLinkRecordAction({
      action: "link_record",
      exceptionId,
      sourceType: "bank_transaction",
      sourceId: bankTransactionId,
      targetType: "settlement",
      targetId: settlementId,
    }, authorization);
    const after = await db.select().from(matches).where(and(eq(matches.runId, runId), eq(matches.sourceId, bankTransactionId)));

    expect(result).toMatchObject({ status: "linked", created: false, exceptionResolved: false });
    expect(after).toHaveLength(before.length);
  });

  it("rejects a conflicting existing link", async () => {
    await expect(executeLinkRecordAction({
      action: "link_record",
      exceptionId: conflictingExceptionId,
      sourceType: "bank_transaction",
      sourceId: conflictingBankId,
      targetType: "settlement",
      targetId: settlementId,
    }, authorization)).rejects.toThrow(/already linked to a different settlement/);
  });
});
