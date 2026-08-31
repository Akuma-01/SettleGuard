# SettleGuard

AI finance controller that reconciles payments, refunds, settlements, and
bank credits, investigates mismatches with a bounded tool-calling agent,
and reports measured match/exception accuracy with an honest unresolved list.

Built for the Razorpay AI Buildathon, Track 04 — AI Finance Controller.

**Status: Day 7 in progress — Phases 0-3 and the agent vertical slice
are done; evidence and safe deterministic-analysis tools are now built.** The full loop — load exception → agent investigates →
policy decides → evidence page displays it — is wired end to end on a
tiny dataset. Every piece except the live model call is tested against
real Postgres or scripted fake models (no Anthropic API key available
real Postgres or scripted fake models; the CLI itself fails clearly and
safely without an API key, ready for your own key.

## Run it

```bash
npm install
npm run proof && npm run generate:demo && npm run generate:benchmark && npm run generate:agent-slice

cd apps/api && npm install
cp .env.example .env       # see apps/api/README.md for Postgres + Anthropic setup
npm run db:push
npm test                    # 97 tests
npm run benchmark           # 100% precision/recall, unattended

npm run ingest -- ../../datasets/agent-slice agent-slice-001
npm run reconcile -- <batchId>       # printed by ingest above
npm run investigate -- <exceptionId>  # printed by reconcile above — needs ANTHROPIC_API_KEY
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
  Day 7's tool layer so far: 10 input-validated evidence tools and 4
  deterministic analysis tools, plus 2 authorization-gated workflow
  actions for review cases and adjustment proposals,
  a tool-calling loop with an exact 8-call budget and isolated provider/tool
  failures, Zod-validated structured output with one repair retry
  before an honest `AI_ERROR`, a minimal policy stub, and a plain
  static HTML evidence page. Direct linking, reclassification, and
  resolution remain gated on Phase 5's real policy engine.

## What's next

Phase 4, Steps 2-5: controlled-action tools, a more capable loop, and a
refined system prompt informed by
what Day 6's slice actually needed. `npm run benchmark` still needs
to pass 100%/100% after — the agent is additive, never a replacement
for the deterministic core underneath it. Full 14-day pace is in the
architecture doc.

## Structure so far

```
settleguard/
├── apps/api/
│   ├── src/{db,ingestion,reconciliation,benchmark,agent,cli}/
│   └── tests/
├── scripts/
│   ├── phase1-step1-proof.ts
│   ├── generate-dataset.ts
│   └── generator/
├── datasets/{demo,benchmark,agent-slice}/
├── docs/SCOPE_AND_DECISIONS.md
```

`apps/web` and `packages/` get created when their phases start (the
frontend in Phase 7) — not before, on purpose.
