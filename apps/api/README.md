# @settleguard/api

SettleGuard's API-side backend through Day 7: ingestion, deterministic
reconciliation, benchmarking, and the bounded investigation agent.

## Setup

You need a local PostgreSQL 16 (any 14+ should work). Two options:

**Option A — already have Postgres:**
```bash
createdb settleguard
psql settleguard -c "CREATE USER settleguard WITH PASSWORD 'settleguard_dev' CREATEDB;"
psql settleguard -c "GRANT ALL ON DATABASE settleguard TO settleguard;"
```

**Option B — Docker:**
```bash
docker run --name settleguard-pg -e POSTGRES_USER=settleguard \
  -e POSTGRES_PASSWORD=settleguard_dev -e POSTGRES_DB=settleguard \
  -p 5432:5432 -d postgres:16
```

Then:
```bash
cp .env.example .env       # defaults already match Option A/B above
npm install
npm run db:push            # creates all 15 tables from src/db/schema.ts
npm test                   # 92 tests across ingestion, reconciliation, benchmark, and agent layers
npm run ingest -- ../../datasets/demo demo-001
npm run reconcile -- 1     # use whatever batch id the ingest above printed
```

Expect ingestion:
```text
Batch N ("demo-001")
  payments            500 inserted
  refunds              65 inserted
  settlements          30 inserted
  bankTransactions     30 inserted
  adjustments           3 inserted
```

Then reconciliation:
```text
Reconciliation run N — batch N
Total records:   628
Matched:         609
Unmatched:       19
Match rate:      96.97%
Exceptions:      19

  UNKNOWN_ADJUSTMENT     3
  MISSING_SETTLEMENT     3
  FEE_MISMATCH           4
  BANK_CREDIT_MISMATCH   4
  AMBIGUOUS_MATCH        2
  DUPLICATE_REFUND       3
```

That's exactly the 19 exceptions `datasets/demo/ground_truth.json` says
were injected — same breakdown, every one field-verified, not just
counted. Try the same against `../../datasets/benchmark` after
`npm run generate:benchmark` for the 5,000-payment / 125-exception case.

`npm run db:studio` opens Drizzle Studio (a local DB browser) if you
want to look at what landed without writing SQL by hand.

## Benchmark — one command, unattended

`npm run ingest` + `npm run reconcile` above are two manual steps.
`npm run benchmark` does both plus scoring, in one shot, against a
fresh batch every time:

```bash
npm run benchmark                    # defaults to datasets/benchmark (5,000 payments)
npm run benchmark -- --dataset demo  # quicker sanity check, 500 payments
```

```text
Match rate: 98.05%
Precision:  100.00%  (125/125 flagged exceptions were real)
Recall:     100.00%  (125/125 injected exceptions were caught)
Throughput: 3314 records/sec (reconciliation only, 1767ms for 5855 records)
```

Run this after every later phase (the agent, the policy engine, the
API layer) — it's the fastest way to confirm new work hasn't quietly
regressed the deterministic core underneath it. Exits non-zero on
anything less than 100%/100%, so it's CI-friendly too.

## The agent (Phase 4 — Day 7 in progress)

```bash
npm run investigate -- <exceptionId>
```

Requires `ANTHROPIC_API_KEY` in `.env` — everything else in this repo
is pure deterministic code with zero AI, but this one command makes a
real Claude call. Without a key it fails immediately and clearly
rather than hanging on a doomed network request.

To try it against the tiny purpose-built slice dataset (20 payments,
3 refunds, 1 settlement, 1 unknown adjustment — nothing else):

```bash
cd ../..                                              # project root
npm run generate:agent-slice
cd apps/api
npm run ingest -- ../../datasets/agent-slice agent-slice-001
npm run reconcile -- <batchId>        # printed above
npm run investigate -- <exceptionId>   # printed above
open investigation-<exceptionId>.html  # the "plain page" evidence display
```

The model-facing catalog has 10 read-only evidence tools and 4
deterministic analysis tools. It can fetch related financial records,
reconstruct expected settlements and fees, compare bank credits, and
score candidate matches without calculating money itself. It always ends by producing
Zod-validated structured JSON (`rootCause`, `confidence`, `evidence`,
`recommendedAction`, `requiresHumanApproval`, `explanation`); an
invalid response gets one repair retry, then an honest `AI_ERROR`
rather than a fabricated result. A minimal policy stub opens a review
case when the agent flags `requiresHumanApproval` — not Phase 5's real
policy engine yet, just enough to complete the loop end to end.

Two controlled workflow actions (`create_review_case` and
`propose_adjustment`) live in a separate catalog. They require trusted
authorization supplied outside model input, are idempotent on retry,
and create audit records. They are not exposed to the normal agent loop.
Direct linking, reclassification, and resolution wait for Phase 5's
policy gates. No action moves money or mutates source financial records.

Everything except the live model call is tested without needing an
API key: the tools against real Postgres, the Zod schema, and the
entire tool-calling + repair-retry loop via scripted fake models
(`npm test` covers all of it, plus a full integration test that runs
`investigateException` end to end with a scripted response).

## What's here

```text
src/
├── db/
│   ├── schema.ts       all 15 tables from architecture doc §1.6
│   └── client.ts         drizzle + pg connection
├── ingestion/
│   ├── schemas.ts          Zod validation, one schema per CSV
│   ├── normalize.ts          rupee-string -> paise, empty -> null, etc.
│   ├── parse-csv.ts           papaparse + Zod, row-level error collection
│   └── ingest-batch.ts         orchestrates a full dataset folder -> DB
├── reconciliation/
│   ├── money.ts                fee/tax/date helpers
│   ├── settlement-reconciler.ts  date-inferred payment matching, MISSING_SETTLEMENT,
│   │                              FEE_MISMATCH, UNKNOWN_ADJUSTMENT, expected_net_paise
│   ├── bank-reconciler.ts          Stage A/B bank matching, BANK_CREDIT_MISMATCH, AMBIGUOUS_MATCH
│   ├── duplicate-refunds.ts          global DUPLICATE_REFUND scan
│   └── run.ts                          orchestrator: loads a batch, writes matches/exceptions
├── benchmark/
│   ├── id-resolver.ts        external ID (ground_truth.json) -> internal DB id
│   ├── score.ts                 precision/recall against ground truth, per-type breakdown
│   └── run-benchmark.ts            fresh ingest -> timed reconcile -> score, one shot
├── agent/
│   ├── schema.ts              InvestigationResult Zod schema
│   ├── tools.ts                 read-only evidence catalog + dispatcher
│   ├── analysis-tools.ts          deterministic calculation/comparison tools
│   ├── controlled-actions.ts        authorization-gated review/proposal actions
│   ├── system-prompt.ts           golden rule, structured output requirement
│   ├── loop.ts                      tool-calling loop + repair-retry (no SDK import — testable without a key)
│   ├── client.ts                      real Anthropic SDK wrapper (only file that imports it)
│   ├── investigate.ts                   orchestrator: load -> agent -> policy stub -> evidence page
│   └── evidence-html.ts                   the "plain page" static HTML generator
└── cli/
    ├── ingest.ts        npm run ingest -- <dir> [batch-name]
    ├── reconcile.ts       npm run reconcile -- <batchId>
    ├── benchmark.ts         npm run benchmark [-- --dataset demo|benchmark]
    └── investigate.ts         npm run investigate -- <exceptionId>
```

`routes/`, `controllers/`, `policies/`, `workers/` from the repository
layout aren't created yet — they show up as Phase 6's API layer,
Phase 5's real policy engine, and Phase 8's queues actually need them.
`agent/` remains bounded by design: model-facing tools read and analyze;
workflow writes require out-of-band authorization, and financial source
records are never directly mutable by the model.
