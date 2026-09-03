# Five-minute demo flow

## 0:00–0:35 — Problem and safety boundary

Explain that settlement records are fragmented and that a generic chatbot must
not calculate or change money. Show the README architecture: code owns facts and
arithmetic; the agent investigates; policy controls actions.

## 0:35–1:20 — Run real reconciliation

Open the control room and select **Run demo**. Point out that the batch is
ingested and reconciled through the API, then show the measured match rate,
record count, exceptions, and amount at risk. Do not use a pre-filled screenshot
as a substitute for this action.

## 1:20–2:10 — Triage exceptions

Open **Exceptions**, filter by run, status, or type, and choose a high-value case.
Explain the explicit taxonomy and why unresolved cases remain visible.

## 2:10–3:20 — Explain one investigation

On exception detail, contrast deterministic evidence with the agent conclusion.
Walk through confidence, recommendation, approval requirement, ordered tool
events, and grounded inputs/outputs. If a provider key is configured, run an
investigation; otherwise use a previously completed local case and say so.

## 3:20–4:10 — Human control and audit

Show a pending review. Enter reviewer identity and a meaningful note, then
approve, reject, or mark unresolved. Open **Audit trail** to show the resulting
actor, action, entity, timestamp, and structured before/after payload.

## 4:10–4:45 — Measured evaluation

Show `docs/BENCHMARK_RESULTS.md` or run `npm run benchmark`. Emphasize that the
125 exceptions are compared with generator ground truth, not manually labeled in
the UI, and that the command fails on a precision/recall regression.

## 4:45–5:00 — Close

Summarize: deterministic finance core, bounded evidence-gathering agent,
policy-controlled resolution, human review, and honest unresolved outcomes.
