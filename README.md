# SettleGuard

AI finance controller that reconciles payments, refunds, settlements, and
bank credits, investigates mismatches with a bounded tool-calling agent,
and reports measured match/exception accuracy with an honest unresolved list.

Built for the Razorpay AI Buildathon, Track 04 — AI Finance Controller.

**Status: Phases 1-6 are complete.** CSV ingestion, deterministic
reconciliation, benchmark scoring, bounded AI investigation, policy-controlled
resolution, human review, audit history, and the complete HTTP API are wired end
to end. The test suite uses real PostgreSQL for integration paths and scripted
models where an Anthropic call is not the behavior under test.

## Run it

```bash
npm install
npm run proof && npm run generate:demo && npm run generate:benchmark && npm run generate:agent-slice

cd apps/api && npm install
cp .env.example .env       # see apps/api/README.md for Postgres + Anthropic setup
npm run db:push
npm test                    # 219 tests
npm run benchmark           # 100% precision/recall, unattended
npm run dev                 # HTTP API on http://localhost:4000

npm run ingest -- ../../datasets/agent-slice agent-slice-001
npm run reconcile -- <batchId>       # printed by ingest above
npm run investigate -- <exceptionId>  # printed by reconcile above — needs ANTHROPIC_API_KEY
npm run agent:regression -- <runId>   # six real exception classes — needs ANTHROPIC_API_KEY
```

## What's built

- **Phase 1** (`scripts/`) — synthetic data generator, 4 scale tiers
  now including a tiny agent-slice preset (Day 1-2, 6).
- **Phase 2** (`apps/api/src/db/`, `.../ingestion/`, `.../reconciliation/`)
  — PostgreSQL schema, CSV ingestion, the full deterministic matching
  and exception-detection engine (Days 3-4). Zero AI.
- **Phase 3** (`apps/api/src/benchmark/`) — `npm run benchmark`: one
  unattended command, 100% precision/recall at both demo and benchmark
  scale (Day 5).
- **Phase 4** (`apps/api/src/agent/`) — the agent vertical slice plus
  10 input-validated evidence tools and 4
  deterministic analysis tools, plus 2 authorization-gated workflow
  actions for review cases and adjustment proposals,
  a tool-calling loop with an exact 8-call budget and isolated provider/tool
  failures, record-grounded evidence citations, Zod-validated structured output with one repair retry
  before an honest `AI_ERROR`, and a static HTML evidence page.
- **Phase 5** (`apps/api/src/policy/`) — deterministic authorization gates,
  safe auto-resolution, human-review decisions, rerun assessment, controlled
  link actions, and immutable audit entries.
- **Phase 6** (`apps/api/src/http/`) — the complete Fastify API for loading or
  uploading batches, reconciliation, metrics, exceptions, investigation,
  review decisions, and audit history.

## What's next

Phase 7 builds the control-room frontend on the existing API: dashboard,
exception list, exception detail, and human-review actions. The deterministic
benchmark remains the regression gate underneath the agent and UI.

## Structure so far

```
settleguard/
├── apps/api/
│   ├── src/{db,ingestion,reconciliation,benchmark,agent,policy,http,cli}/
│   └── tests/
├── scripts/
│   ├── phase1-step1-proof.ts
│   ├── generate-dataset.ts
│   └── generator/
└── datasets/{demo,benchmark,agent-slice}/
```

`apps/web` is the next addition for Phase 7.
