import { describe, expect, it } from "vitest";
import { matchBankTransactions } from "../src/reconciliation/bank-reconciler.js";
import type { BankTransactionRecord, SettlementRecord } from "../src/db/schema.js";

let idSeq = 1;
const nextId = () => idSeq++;

function mkSettlement(overrides: Partial<SettlementRecord> = {}): SettlementRecord {
  return {
    id: nextId(),
    batchId: 1,
    externalSettlementId: "SET_20260305",
    grossAmountPaise: 100000,
    feeAmountPaise: 2000,
    taxAmountPaise: 360,
    adjustmentAmountPaise: 0,
    expectedNetPaise: null,
    reportedNetPaise: 97640,
    settledAt: new Date("2026-03-06T18:00:00Z"),
    bankReference: "UTR20260305001",
    rawPayload: {},
    ...overrides,
  };
}

function mkBank(overrides: Partial<BankTransactionRecord> = {}): BankTransactionRecord {
  return {
    id: nextId(),
    batchId: 1,
    externalBankId: "BANK_1",
    amountPaise: 97640,
    direction: "credit",
    postedAt: new Date("2026-03-07T09:00:00Z"),
    reference: "UTR20260305001",
    description: "NEFT settlement credit",
    rawPayload: {},
    ...overrides,
  };
}

describe("matchBankTransactions — Stage A", () => {
  it("matches cleanly on exact reference with no exceptions when amounts agree", () => {
    const settlement = mkSettlement();
    const bank = mkBank({ reference: settlement.bankReference!, amountPaise: settlement.reportedNetPaise });

    const [result] = matchBankTransactions([bank], [settlement]);

    expect(result!.matchType).toBe("stage_a");
    expect(result!.settlementId).toBe(settlement.id);
    expect(result!.exceptions).toHaveLength(0);
  });

  it("flags BANK_CREDIT_MISMATCH when the reference matches but the amount doesn't", () => {
    const settlement = mkSettlement({ reportedNetPaise: 97640 });
    const bank = mkBank({ reference: settlement.bankReference!, amountPaise: 100000 });

    const [result] = matchBankTransactions([bank], [settlement]);

    expect(result!.matchType).toBe("stage_a");
    expect(result!.exceptions).toHaveLength(1);
    expect(result!.exceptions[0]!.type).toBe("BANK_CREDIT_MISMATCH");
    expect(result!.exceptions[0]!.amountAtRiskPaise).toBe(100000 - 97640);
  });
});

describe("matchBankTransactions — Stage B fallback", () => {
  it("resolves via amount + date when the reference is garbled, and flags AMBIGUOUS_MATCH", () => {
    const settlement = mkSettlement({ reportedNetPaise: 97640, settledAt: new Date("2026-03-06T18:00:00Z") });
    const bank = mkBank({
      reference: "NEFT-BATCH-552424", // garbled, doesn't match settlement.bankReference
      amountPaise: 97640, // exact amount still matches
      postedAt: new Date("2026-03-07T09:00:00Z"), // within the date window
    });

    const [result] = matchBankTransactions([bank], [settlement]);

    expect(result!.matchType).toBe("stage_b");
    expect(result!.settlementId).toBe(settlement.id);
    expect(result!.exceptions).toHaveLength(1);
    expect(result!.exceptions[0]!.type).toBe("AMBIGUOUS_MATCH");
  });

  it("leaves a bank transaction unmatched when neither reference nor amount+date resolve", () => {
    const settlement = mkSettlement({ reportedNetPaise: 97640, settledAt: new Date("2026-03-06T18:00:00Z") });
    const bank = mkBank({
      reference: "NEFT-BATCH-999999",
      amountPaise: 12345, // matches nothing
      postedAt: new Date("2026-03-07T09:00:00Z"),
    });

    const [result] = matchBankTransactions([bank], [settlement]);

    expect(result!.matchType).toBe("unmatched");
    expect(result!.settlementId).toBeNull();
  });

  it("does not fall back across too wide a date gap even if the amount matches", () => {
    const settlement = mkSettlement({ reportedNetPaise: 97640, settledAt: new Date("2026-03-06T18:00:00Z") });
    const bank = mkBank({
      reference: "NEFT-BATCH-999999",
      amountPaise: 97640,
      postedAt: new Date("2026-04-15T09:00:00Z"), // weeks away — same amount, wrong era
    });

    const [result] = matchBankTransactions([bank], [settlement]);

    expect(result!.matchType).toBe("unmatched");
  });
});
