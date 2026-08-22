# SettleGuard

AI finance controller that reconciles payments, refunds, settlements, and
bank credits, investigates mismatches with a bounded tool-calling agent,
and reports measured match/exception accuracy with an honest unresolved list.

Built for the Razorpay AI Buildathon, Track 04 — AI Finance Controller.

**Status: Day 1 — Phase 0 done, Phase 1 · Step 1 done.** See
`Day1_Plan.md` (shared alongside this repo) for the full write-up, and
`docs/PHASE_0_SCOPE.md` for the frozen scope.

## Run today's proof

```bash
npm install
npm run proof
```

This runs a self-contained script — no database, no framework, no LLM —
that generates a small seeded dataset, calculates an expected settlement
with plain arithmetic, injects three known errors, and detects all three
deterministically. It's the foundation everything else builds on.

## What's next

Phase 1 · Step 2 (Day 2): the real synthetic data generator — payments,
refunds, settlements, bank ledger, an exception injector, and a
`ground_truth.json` to benchmark against. Full 14-day pace is in the
architecture doc.

## Structure so far

```
settleguard/
├── scripts/
│   └── phase1-step1-proof.ts   # today's proof script
├── docs/
│   └── PHASE_0_SCOPE.md        # frozen scope (Phase 0 deliverable)
├── package.json
├── tsconfig.json
└── .env.example                 # not used yet — Phase 2+
```

`apps/api`, `apps/web`, `packages/`, and `datasets/` get created when
their phases start (Postgres in Phase 2, the agent in Phase 4, the
frontend in Phase 7) — not before, on purpose.
