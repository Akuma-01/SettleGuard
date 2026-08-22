# SettleGuard — Scope and Design Decisions

SettleGuard is an AI finance controller for settlement reconciliation. It helps a merchant finance operator explain why expected settlement amounts do not match the money that actually reaches the bank.

The product is intentionally narrow: **reconcile first, investigate exceptions second, and never hide uncertainty.**

## Problem

Payment operations are spread across multiple records: payments, refunds, processor settlements, adjustments, and bank transactions. When the numbers do not line up, finance teams often have to trace those records manually to answer a simple question:

> Why did the amount we expected differ from the amount we received?

SettleGuard turns that investigation into a repeatable workflow.

## Primary user

A merchant finance or operations team responsible for daily settlement reconciliation.

## Core workflow

1. Ingest payment, refund, settlement, adjustment, and bank transaction data.
2. Normalize records into a consistent internal representation.
3. Match records and calculate expected settlement amounts deterministically.
4. Detect mismatches and create explicit exceptions.
5. Investigate ambiguous exceptions using a bounded, tool-calling AI agent.
6. Resolve when the evidence is sufficient; otherwise return an honest unresolved case with supporting evidence.

## What is in scope

- Multi-source settlement reconciliation
- Payment, refund, settlement, adjustment, and bank-credit matching
- Deterministic money calculations and reconciliation rules
- Exception detection and classification
- AI-assisted investigation of ambiguous mismatches
- Evidence/provenance for conclusions
- Explicit unresolved outcomes when confidence is insufficient
- Synthetic datasets with ground truth for repeatable evaluation
- Measured reconciliation and exception-detection performance

## What is out of scope

For the current version, SettleGuard is **not** trying to become:

- a generic finance chatbot
- a cash-flow forecasting product
- a tax engine
- an invoicing system
- a collections or revenue-recovery platform
- a general-purpose accounting replacement

Those may be useful products, but they do not improve the core reconciliation loop enough to justify expanding the surface area yet.

## AI boundary

**Use AI for ambiguity and judgment. Use code for facts and money.**

Deterministic code owns:

- arithmetic and currency values
- expected settlement calculations
- normalization
- exact and rule-based matching
- thresholds and invariants
- benchmark scoring

The AI agent is used only when the remaining problem requires interpretation or investigation, such as comparing plausible explanations across multiple records.

The agent must not silently change financial facts. Its conclusions should be tied to retrieved evidence, and it should be able to stop with an unresolved result rather than invent an answer.

## Success criteria

SettleGuard should be judged on whether it can:

- reconcile records accurately against known ground truth
- detect injected settlement exceptions reliably
- preserve exact monetary calculations
- explain the evidence behind an investigation result
- avoid false certainty when the available evidence is insufficient
- reproduce the same benchmark results from the same dataset

The goal is not to maximize the number of AI calls. The goal is to use AI only where it adds judgment that deterministic reconciliation cannot provide safely.

## Scope rule

A feature belongs in the current build only if it materially improves one of the following:

- reconciliation accuracy
- exception detection
- investigation quality
- reliability and safety
- evaluation quality
- clarity of the end-to-end demo

Everything else waits.
