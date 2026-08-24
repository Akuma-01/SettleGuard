# @settleguard/api

Phase 2's backend. Today (Day 3) it only ingests — no routes, no
matching engine yet. That's Day 4.

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
npm test                   # 34 tests: normalization, validation, matching, exceptions
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
└── cli/
    ├── ingest.ts        npm run ingest -- <dir> [batch-name]
    └── reconcile.ts       npm run reconcile -- <batchId>
```

`routes/`, `controllers/`, `agent/`, `policies/`, `workers/` from the
repository layout aren't created yet — they show up as Phase 4's agent,
Phase 5's policy engine, Phase 6's API layer, and Phase 8's queues
actually need them.
