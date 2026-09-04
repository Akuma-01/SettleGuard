# Three-minute judge demo

## Before presenting

- Start PostgreSQL, the API, and the web app; confirm the header says **Systems operational**.
- Prepare one genuine completed Gemini investigation and keep its exception page
  open in a second tab. A duplicate refund is the clearest judge-facing example.
- Do not spend Gemini quota testing immediately before the presentation.
- Close terminals, environment files, bookmarks, notifications, and unrelated
  tabs before recording. Record at 1080p with browser zoom between 90% and 100%.

## Recording mode

Use a stored, genuinely generated Gemini result for the final recording. This is
more reliable than waiting for a live provider response on camera and remains an
honest demonstration: the conclusion, tool trace, evidence, policy decision, and
timestamps all come from the persisted investigation.

Before recording:

1. Run the demo once and note its run ID.
2. Complete one Gemini investigation for its priority exception.
3. Confirm the page shows **Latest completed investigation** and validated agent
   activity, with `gemini-3.6-flash` visible beside the investigation ID. A later
   quota failure may appear as a separate warning but will not replace the
   validated result.
4. Keep the prepared exception page open in a second tab.

During recording, run a fresh deterministic reconciliation for the first segment,
then switch to the prepared exception tab for the AI segment. State that it is a
previously completed Gemini investigation. Do not imply that the call happened
live if it did not.

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

Switch to the prepared Gemini investigation and mention the eight-tool cap,
schema validation, and persisted evidence. If showing a newer failed attempt,
point out that the last validated result remains visible while the provider
failure is labeled separately; SettleGuard never invents a replacement conclusion.

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

## Final recording checklist

- Keep the video between two and three minutes.
- Show the product within the first 20 seconds.
- Keep API keys and terminal output out of frame.
- Verify narration is audible and financial amounts are readable.
- Watch the exported video once before uploading it.
- Add the final video URL to [Submission](SUBMISSION.md).
