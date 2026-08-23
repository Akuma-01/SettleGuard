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
npm test                   # 18 tests: normalization + validation
npm run ingest -- ../../datasets/demo demo-001
```

Expect:
```text
Batch N ("demo-001")
  payments            500 inserted
  refunds              65 inserted
  settlements          30 inserted
  bankTransactions     30 inserted
  adjustments           3 inserted
```

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
└── cli/
    └── ingest.ts        entrypoint: npm run ingest -- <dir> [batch-name]
```

`routes/`, `controllers/`, `agent/`, `reconciliation/`, `policies/`,
`workers/` from the repository layout aren't created yet — they show
up as Phase 2's matching stages (Day 4), Phase 4's agent, Phase 5's
policy engine, and Phase 8's queues actually need them.
