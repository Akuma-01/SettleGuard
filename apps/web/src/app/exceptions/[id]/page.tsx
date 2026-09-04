import Link from "next/link";
import { ControlRoomShell } from "@/components/control-room-shell";
import { PendingButton } from "@/components/pending-button";
import { getExceptionDetail } from "@/lib/api";
import { investigateAction, reviewAction } from "./actions";

export const dynamic = "force-dynamic";
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function JsonEvidence({ value }: { value: unknown }) {
  if (value == null) return <p className="quiet">No structured evidence recorded.</p>;
  return <pre className="evidence-json">{JSON.stringify(value, null, 2)}</pre>;
}

function investigationFailure(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value) || typeof value.error !== "string") return null;
  if (/429|quota|rate limit/i.test(value.error)) return "Provider quota reached. The deterministic evidence remains available and a human review case was created.";
  if (/500|502|503|504|high demand|unavailable/i.test(value.error)) return "Provider temporarily unavailable. The deterministic evidence remains available and a human review case was created.";
  if (/timed? out|timeout/i.test(value.error)) return "Provider response timed out. The deterministic evidence remains available and a human review case was created.";
  return "No validated AI conclusion was produced. The deterministic evidence remains available and a human review case was created.";
}

export default async function ExceptionDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [{ id }, feedback] = await Promise.all([params, searchParams]);
  const exceptionId = /^[1-9]\d*$/.test(id) ? Number(id) : null;
  const result = exceptionId ? await getExceptionDetail(exceptionId) : { status: "not_found" as const };

  if (result.status !== "ready") return (
    <ControlRoomShell active="Exceptions" eyebrow="SETTLEMENT OPERATIONS / EXCEPTION" title="Exception detail">
      <section className="list-message"><h2>{result.status === "not_found" ? "Exception not found." : "Exception unavailable."}</h2><p>{result.status === "not_found" ? "Check the exception ID and return to the ledger." : "Start the API and retry this page."}</p><Link className="back-link" href="/exceptions">← Back to exceptions</Link></section>
    </ControlRoomShell>
  );

  const { exception, run, batch, investigations, reviewCases, auditTrail } = result.data;
  const latestAttempt = investigations[0];
  const latestCompletedIndex = investigations.findIndex(({ investigation }) => investigation.status === "completed");
  const latestCompleted = latestCompletedIndex >= 0 ? investigations[latestCompletedIndex] : undefined;
  const newerFailures = investigations
    .slice(0, latestCompletedIndex >= 0 ? latestCompletedIndex : investigations.length)
    .filter(({ investigation }) => investigation.status === "failed");
  const latestFailure = newerFailures[0];
  const latestFailureMessage = latestFailure
    ? investigationFailure(latestFailure.investigation.structuredOutputJson)
    : null;
  return (
    <ControlRoomShell active="Exceptions" eyebrow={`RUN #${run.id} / EXCEPTION #${exception.id}`} title={label(exception.type)} actions={<Link className="back-link" href={`/exceptions?runId=${run.id}`}>← Exception ledger</Link>}>
      <div className="detail-page">
        {(feedback.notice || feedback.error) && <div className={feedback.error ? "action-feedback error" : "action-feedback"}>{feedback.error ?? feedback.notice}</div>}
        <section className="detail-hero">
          <div><span className={`exception-status ${exception.status.toLowerCase()}`}>{label(exception.status)}</span><p>{exception.summary ?? "No summary recorded"}</p><small>{batch.merchantName} · {batch.name} · {exception.severity} severity</small></div>
          <div className="hero-risk"><span>AMOUNT AT RISK</span><strong>{money.format(exception.amountAtRiskPaise / 100)}</strong></div>
        </section>

        {exception.status === "OPEN" && <section className="action-panel"><div><span className="sequence">CONTROLLED ACTION</span><h3>Run AI investigation</h3><p>The bounded agent gathers evidence; deterministic policy decides whether any recommendation can execute.</p></div><form action={investigateAction.bind(null, exception.id)}><PendingButton pendingLabel="Investigating…">Investigate exception</PendingButton></form></section>}

        <section className="detail-grid">
          <article className="detail-panel evidence-panel"><div className="panel-heading"><div><span className="sequence">DETERMINISTIC LAYER</span><h3>Recorded evidence</h3></div><span>{exception.primaryRecordType ? `${exception.primaryRecordType} #${exception.primaryRecordId}` : "No primary record"}</span></div><JsonEvidence value={exception.deterministicEvidenceJson} /></article>
          <article className="detail-panel"><div className="panel-heading"><div><span className="sequence">AGENT CONCLUSION</span><h3>Latest completed investigation</h3></div><span>{latestCompleted ? `#${latestCompleted.investigation.id} · ${latestCompleted.investigation.model ?? "model unavailable"}` : "None completed"}</span></div>
            {latestFailure && <div className="agent-degraded"><strong>Newer attempt #{latestFailure.investigation.id} did not complete</strong><p>{latestFailureMessage ?? "No validated AI conclusion was produced by the newer attempt."}</p><small>The last validated result remains visible below; no failed output was fabricated or auto-applied.</small></div>}
            {latestCompleted ? <div className="conclusion"><div><span>Root cause</span><strong>{latestCompleted.investigation.rootCause ? label(latestCompleted.investigation.rootCause) : "Unresolved"}</strong></div><div><span>Confidence</span><strong>{latestCompleted.investigation.confidence == null ? "—" : `${Math.round(latestCompleted.investigation.confidence * 100)}%`}</strong></div><div><span>Recommended action</span><strong>{latestCompleted.investigation.recommendedAction ? label(latestCompleted.investigation.recommendedAction) : "No action"}</strong></div><div><span>Approval</span><strong>{latestCompleted.investigation.requiresHumanApproval ? "Human required" : "Policy eligible"}</strong></div></div> : <p className="quiet padded">{latestAttempt ? "No investigation has produced a validated conclusion yet." : "This exception has not been investigated."}</p>}
          </article>
        </section>

        <section className="detail-grid timeline-grid">
          <article className="detail-panel"><div className="panel-heading"><div><span className="sequence">OBSERVABLE REASONING</span><h3>Validated agent activity</h3></div><span>{latestCompleted?.events.length ?? 0} events</span></div>
            <div className="event-list">{latestCompleted?.events.map((event) => <div className="event" key={event.id}><span>{String(event.sequenceNumber).padStart(2, "0")}</span><div><strong>{label(event.eventType)}{event.toolName ? ` · ${label(event.toolName)}` : ""}</strong><small>{date.format(new Date(event.createdAt))}</small>{event.toolInputJson != null && <JsonEvidence value={event.toolInputJson} />}{event.toolOutputJson != null && <JsonEvidence value={event.toolOutputJson} />}</div></div>)}{!latestCompleted?.events.length && <p className="quiet padded">No validated agent events recorded.</p>}</div>
          </article>
          <div className="detail-stack">
            <article className="detail-panel"><div className="panel-heading"><div><span className="sequence">HUMAN CONTROL</span><h3>Review cases</h3></div><span>{reviewCases.length}</span></div><div className="compact-list">{reviewCases.map((review) => review.status === "pending" ? <form className="review-form" action={reviewAction.bind(null, exception.id, review.id)} key={review.id}><strong>#{review.id} · {review.proposedAction ? label(review.proposedAction) : "proposed action"}</strong><input name="reviewerId" placeholder="Reviewer ID" maxLength={200} required /><textarea name="note" placeholder="Decision note" maxLength={2000} required /><div><PendingButton name="decision" value="approve" pendingLabel="Recording…">Approve</PendingButton><PendingButton className="secondary" name="decision" value="reject" pendingLabel="Recording…">Reject</PendingButton><PendingButton className="secondary" name="decision" value="mark_unresolved" pendingLabel="Recording…">Mark unresolved</PendingButton></div></form> : <div key={review.id}><span>#{review.id} · {label(review.status)}</span><strong>{review.reviewerDecision ? label(review.reviewerDecision) : label(review.proposedAction ?? "decided")}</strong>{review.reviewerNote && <small>{review.reviewerNote}</small>}</div>)}{reviewCases.length === 0 && <p className="quiet padded">No review case created.</p>}</div></article>
            <article className="detail-panel"><div className="panel-heading"><div><span className="sequence">PROVENANCE</span><h3>Audit trail</h3></div><span>{auditTrail.length}</span></div><div className="compact-list">{auditTrail.map((audit) => <div key={audit.id}><span>{label(audit.actorType)} · {date.format(new Date(audit.createdAt))}</span><strong>{label(audit.action)}</strong></div>)}</div></article>
          </div>
        </section>
      </div>
    </ControlRoomShell>
  );
}
