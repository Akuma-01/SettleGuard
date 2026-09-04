# @settleguard/api

SettleGuard's backend through Phase 6: ingestion, deterministic reconciliation,
benchmarking, bounded AI investigation, policy-controlled resolution, human
review, audit history, and the HTTP API.

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
npm test                   # 219 tests across all backend layers
npm run ingest -- ../../datasets/demo demo-001
npm run reconcile -- 1     # use whatever batch id the ingest above printed
```

## HTTP API (Phase 6 complete)

Start the service after setup:

```bash
npm run dev
curl http://localhost:4000/health
```

Load the bundled demo data and run reconciliation:

```bash
curl -X POST http://localhost:4000/api/batches/demo \
  -H 'content-type: application/json' \
  -d '{"batchName":"demo-api-001"}'

curl -X POST http://localhost:4000/api/batches/1/reconcile
curl http://localhost:4000/api/runs/1/metrics
curl 'http://localhost:4000/api/exceptions?runId=1'
```

Or upload a dataset. The multipart request must contain `batchName` and exactly
one each of `payments.csv`, `refunds.csv`, `settlements.csv`,
`bank_transactions.csv`, and `adjustments.csv` (maximum 5 MB per file):

```bash
curl -X POST http://localhost:4000/api/batches/upload \
  -F 'batchName=my-upload-001' \
  -F 'files=@../../datasets/demo/payments.csv;type=text/csv' \
  -F 'files=@../../datasets/demo/refunds.csv;type=text/csv' \
  -F 'files=@../../datasets/demo/settlements.csv;type=text/csv' \
  -F 'files=@../../datasets/demo/bank_transactions.csv;type=text/csv' \
  -F 'files=@../../datasets/demo/adjustments.csv;type=text/csv'
```

The remaining API surface is:

```text
GET  /api/batches/:id
GET  /api/runs/:id
GET  /api/exceptions/:id
POST /api/exceptions/:id/investigate
POST /api/review-cases/:id/approve
POST /api/review-cases/:id/reject
GET  /api/audit
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
Throughput: 3521 records/sec (reconciliation only, 1663ms for 5855 records)
```

Run this after every later phase (the agent, the policy engine, the
API layer) — it's the fastest way to confirm new work hasn't quietly
regressed the deterministic core underneath it. Exits non-zero on
anything less than 100%/100%, so it's CI-friendly too.

## The agent (Phase 4 complete)

```bash
npm run investigate -- <exceptionId>
```

Set `SETTLEGUARD_AGENT_PROVIDER` to `anthropic` or `gemini` and provide the
matching `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` in `.env`. Everything else in
this repo is pure deterministic code with zero AI, but this command makes a
real provider call. Without the selected provider's key it fails immediately and clearly
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
Zod-validated structured JSON (`exceptionId`, `rootCause`, `confidence`, `evidence`,
`recommendedAction`, `requiresHumanApproval`, `explanation`); an
invalid response gets one repair retry, then an honest `AI_ERROR`
rather than a fabricated result. The policy layer opens a review case when
approval is required; low-risk, strongly supported actions
may be auto-resolved through deterministic Phase 5 gates.

The loop caps actual tool executions at eight, including parallel tool
requests. Oversized batches are not partially executed; malformed calls,
provider failures, and thrown tool errors become explicit controlled
outcomes rather than crashing or leaving an investigation ambiguous.
Every cited internal record ID must also appear in trusted exception
context or verified tool output. Invented citations receive one repair
attempt and then become an explicit `AI_ERROR` if still ungrounded.

Two controlled workflow actions (`create_review_case` and
`propose_adjustment`) live in a separate catalog. They require trusted
authorization supplied outside model input, are idempotent on retry,
and create audit records. They are not exposed to the normal agent loop.
Linking, reclassification, and resolution pass through Phase 5 policy gates.
No action moves money or mutates source financial records.

Everything except the live model call is tested without needing an
API key: the tools against real Postgres, the Zod schema, and the
entire tool-calling + repair-retry loop via scripted fake models
(`npm test` covers all of it, plus a full integration test that runs
`investigateException` end to end with a scripted response).

The model-agnostic regression scorer measures exact
exception identity, accepted root cause/action, approval requirements,
AI errors, and unsafe forced resolutions. An explicit `safe_unresolved`
mode requires `insufficient_evidence` + `no_action` rather than rewarding
the model for guessing.

After `npm run benchmark`, use its reconciliation run ID to exercise one
real exception from every MVP class with the live model:

```bash
npm run agent:regression -- <reconciliationRunId> [outputDirectory]
```

The command requires the selected provider's API key, writes a separate evidence page
for each case, prints pass rate/AI-error/unsafe-resolution counts, and
exits nonzero if any case fails. The six-case set includes an unknown
adjustment that must remain safely unresolved.

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
│   ├── evidence-grounding.ts        verifies cited IDs came from trusted observations
│   ├── controlled-actions.ts        authorization-gated review/proposal actions
│   ├── regression.ts                  multi-scenario agent evaluation and scoring
│   ├── regression-cases.ts              six real exception fixtures + live runner
│   ├── system-prompt.ts           golden rule, structured output requirement
│   ├── loop.ts                      tool-calling loop + repair-retry (no SDK import — testable without a key)
│   ├── client.ts                      real Anthropic SDK wrapper (only file that imports it)
│   ├── investigate.ts                   orchestrator: load -> agent -> policy -> evidence page
│   └── evidence-html.ts                   the "plain page" static HTML generator
├── policy/                                  deterministic resolution and review gates
├── http/
│   ├── app.ts                                 Fastify composition and error handling
│   ├── server.ts                                service entry point
│   └── routes/                                   Phase 6 REST surface
└── cli/
    ├── ingest.ts        npm run ingest -- <dir> [batch-name]
    ├── reconcile.ts       npm run reconcile -- <batchId>
    ├── benchmark.ts         npm run benchmark [-- --dataset demo|benchmark]
    ├── agent-regression.ts    npm run agent:regression -- <runId> [outputDirectory]
    └── investigate.ts         npm run investigate -- <exceptionId>
```

`agent/` remains bounded by design: model-facing tools read and analyze;
workflow writes require out-of-band authorization, and financial source
records are never directly mutable by the model. Background workers remain
optional Phase 8 work if synchronous demo performance proves insufficient.
