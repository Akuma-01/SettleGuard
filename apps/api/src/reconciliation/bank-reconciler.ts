/**
 * SettleGuard bank-transaction matching.
 *
 * Stage A: exact reference match (bank.reference === settlement's own
 * bankReference) — this is the one link in the whole system with a
 * genuine ID to match on, so it's the one genuine Stage A case.
 *
 * Stage B fallback: when the reference doesn't resolve (corrupted, or
 * just genuinely absent), fall back to exact amount + a date window.
 * Finding a match this way still gets flagged — AMBIGUOUS_MATCH — for
 * the fact that reference-matching failed at all, independent of
 * whether the fallback itself succeeded.
 */

import type { BankTransactionRecord, SettlementRecord } from "../db/schema.js";
import { inr } from "./money.js";

const DATE_WINDOW_DAYS = 3;

export interface BankException {
  type: "BANK_CREDIT_MISMATCH" | "AMBIGUOUS_MATCH";
  amountAtRiskPaise: number;
  primaryRecordType: string;
  primaryRecordId: number;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface BankMatchResult {
  bankTransactionId: number;
  settlementId: number | null;
  matchType: "stage_a" | "stage_b" | "unmatched";
  score: number;
  exceptions: BankException[];
}

export function matchBankTransactions(bankTxns: BankTransactionRecord[], settlements: SettlementRecord[]): BankMatchResult[] {
  const results: BankMatchResult[] = [];
  const byBankReference = new Map<string, SettlementRecord>();
  for (const s of settlements) {
    if (s.bankReference) byBankReference.set(s.bankReference, s);
  }

  for (const bank of bankTxns) {
    const exceptions: BankException[] = [];

    // ---- Stage A: exact reference ----
    const stageAMatch = bank.reference ? byBankReference.get(bank.reference) : undefined;
    if (stageAMatch) {
      if (bank.amountPaise !== stageAMatch.reportedNetPaise) {
        exceptions.push({
          type: "BANK_CREDIT_MISMATCH",
          amountAtRiskPaise: Math.abs(bank.amountPaise - stageAMatch.reportedNetPaise),
          primaryRecordType: "settlement",
          primaryRecordId: stageAMatch.id,
          summary: `Bank credit ${bank.externalBankId} posted ${inr(bank.amountPaise)}; settlement ${stageAMatch.externalSettlementId} expected ${inr(stageAMatch.reportedNetPaise)}.`,
          evidence: {
            bankTransactionId: bank.id,
            settlementId: stageAMatch.id,
            expectedPaise: stageAMatch.reportedNetPaise,
            actualPaise: bank.amountPaise,
          },
        });
      }
      results.push({ bankTransactionId: bank.id, settlementId: stageAMatch.id, matchType: "stage_a", score: 100, exceptions });
      continue;
    }

    // ---- Stage B fallback: exact amount + date window ----
    const candidates = settlements.filter((s) => {
      if (s.reportedNetPaise !== bank.amountPaise) return false;
      if (!s.settledAt) return false;
      const diffDays = Math.abs((bank.postedAt.getTime() - s.settledAt.getTime()) / 86_400_000);
      return diffDays <= DATE_WINDOW_DAYS;
    });

    if (candidates.length === 1) {
      const match = candidates[0]!;
      exceptions.push({
        type: "AMBIGUOUS_MATCH",
        amountAtRiskPaise: bank.amountPaise,
        primaryRecordType: "settlement",
        primaryRecordId: match.id,
        summary: `Bank credit ${bank.externalBankId}'s reference ("${bank.reference}") does not match settlement ${match.externalSettlementId}'s bank reference ("${match.bankReference}"); resolved via amount + date instead of an exact reference match.`,
        evidence: {
          bankTransactionId: bank.id,
          settlementId: match.id,
          bankReference: bank.reference,
          settlementBankReference: match.bankReference,
        },
      });
      results.push({ bankTransactionId: bank.id, settlementId: match.id, matchType: "stage_b", score: 75, exceptions });
    } else {
      // 0 or >1 candidates — genuinely unresolved. Not one of today's 6
      // injected types, but not silently dropped either; the caller can
      // see it via matchType: "unmatched".
      results.push({ bankTransactionId: bank.id, settlementId: null, matchType: "unmatched", score: 0, exceptions: [] });
    }
  }

  return results;
}
