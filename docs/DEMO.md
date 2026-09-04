# Three-minute judge demo

## Before presenting

- Start PostgreSQL, the API, and the web app; confirm the header says **Systems operational**.
- Keep one previously investigated duplicate-refund case available as a backup.
- Do not spend Gemini quota testing immediately before the presentation.

## 0:00–0:25 — Problem and boundary

“Payment, refund, settlement, adjustment, and bank records disagree across
systems. SettleGuard reconciles the money deterministically, uses AI only to
gather and explain evidence, and places every action behind policy and human
approval.”

## 0:25–1:00 — Reconcile real records

Select **Run demo**. While the button shows **Loading demo…**, explain that this
is real ingestion and reconciliation—not a prepared screenshot. Show the match
rate, records processed, exceptions detected, and amount at risk. Use the
Reconcile → Investigate → Control strip to frame the rest of the walkthrough.

## 1:00–1:50 — Open the priority case

Select **Inspect evidence** on the priority-case card. Contrast the deterministic
evidence with the bounded agent conclusion. Show grounded tool events, confidence,
recommended action, and the mandatory approval state.

If live Gemini quota is available, select **Investigate exception** and mention
the eight-tool cap and schema validation. If it is unavailable, show the visible
**Deterministic fallback active** state and say: “SettleGuard preserves the
evidence and routes this to a person; it never invents an AI conclusion.”

## 1:50–2:30 — Demonstrate control

Open a pending review case, enter a reviewer ID and meaningful note, then approve,
reject, or mark unresolved. Point out that recommendations do not execute by
themselves and that duplicate submissions are disabled while a decision is being
recorded.

## 2:30–2:50 — Prove auditability and evaluation

Open **Audit trail** and show the actor, action, entity, timestamp, and structured
payload. Mention the measured benchmark: 5,855 records, 98.05% match rate, and
100% precision/recall over 125 injected exceptions.

## 2:50–3:00 — Close

“SettleGuard combines a deterministic finance core, a grounded investigation
agent, and policy-controlled human resolution—so automation stays useful without
becoming financially unsafe.”

## If more time is available

Use the exception ledger filters to show the six-class taxonomy, then compare a
clear duplicate refund with an ambiguous match that remains under human control.
