import Link from "next/link";
import { ControlRoomShell } from "@/components/control-room-shell";
import { getExceptionDetail } from "@/lib/api";

export const dynamic = "force-dynamic";
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

function JsonEvidence({ value }: { value: unknown }) {
  if (value == null) return <p className="quiet">No structured evidence recorded.</p>;
  return <pre className="evidence-json">{JSON.stringify(value, null, 2)}</pre>;
}

export default async function ExceptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const exceptionId = /^[1-9]\d*$/.test(id) ? Number(id) : null;
  const result = exceptionId ? await getExceptionDetail(exceptionId) : { status: "not_found" as const };

  if (result.status !== "ready") return (
    <ControlRoomShell active="Exceptions" eyebrow="SETTLEMENT OPERATIONS / EXCEPTION" title="Exception detail">
      <section className="list-message"><h2>{result.status === "not_found" ? "Exception not found." : "Exception unavailable."}</h2><p>{result.status === "not_found" ? "Check the exception ID and return to the ledger." : "Start the API and retry this page."}</p><Link className="back-link" href="/exceptions">← Back to exceptions</Link></section>
    </ControlRoomShell>
  );

  const { exception, run, batch, investigations, reviewCases, auditTrail } = result.data;
  const latest = investigations[0];
  return (
    <ControlRoomShell active="Exceptions" eyebrow={`RUN #${run.id} / EXCEPTION #${exception.id}`} title={label(exception.type)} actions={<Link className="back-link" href={`/exceptions?runId=${run.id}`}>← Exception ledger</Link>}>
      <div className="detail-page">
        <section className="detail-hero">
          <div><span className={`exception-status ${exception.status.toLowerCase()}`}>{label(exception.status)}</span><p>{exception.summary ?? "No summary recorded"}</p><small>{batch.merchantName} · {batch.name} · {exception.severity} severity</small></div>
          <div className="hero-risk"><span>AMOUNT AT RISK</span><strong>{money.format(exception.amountAtRiskPaise / 100)}</strong></div>
        </section>

        <section className="detail-grid">
          <article className="detail-panel evidence-panel"><div className="panel-heading"><div><span className="sequence">DETERMINISTIC LAYER</span><h3>Recorded evidence</h3></div><span>{exception.primaryRecordType ? `${exception.primaryRecordType} #${exception.primaryRecordId}` : "No primary record"}</span></div><JsonEvidence value={exception.deterministicEvidenceJson} /></article>
          <article className="detail-panel"><div className="panel-heading"><div><span className="sequence">AGENT CONCLUSION</span><h3>Latest investigation</h3></div><span>{latest ? `#${latest.investigation.id}` : "Not started"}</span></div>
            {latest ? <div className="conclusion"><div><span>Root cause</span><strong>{latest.investigation.rootCause ? label(latest.investigation.rootCause) : "Unresolved"}</strong></div><div><span>Confidence</span><strong>{latest.investigation.confidence == null ? "—" : `${Math.round(latest.investigation.confidence * 100)}%`}</strong></div><div><span>Recommended action</span><strong>{latest.investigation.recommendedAction ? label(latest.investigation.recommendedAction) : "No action"}</strong></div><div><span>Approval</span><strong>{latest.investigation.requiresHumanApproval ? "Human required" : "Policy eligible"}</strong></div></div> : <p className="quiet padded">This exception has not been investigated.</p>}
          </article>
        </section>

        <section className="detail-grid timeline-grid">
          <article className="detail-panel"><div className="panel-heading"><div><span className="sequence">OBSERVABLE REASONING</span><h3>Agent activity</h3></div><span>{latest?.events.length ?? 0} events</span></div>
            <div className="event-list">{latest?.events.map((event) => <div className="event" key={event.id}><span>{String(event.sequenceNumber).padStart(2, "0")}</span><div><strong>{label(event.eventType)}{event.toolName ? ` · ${label(event.toolName)}` : ""}</strong><small>{date.format(new Date(event.createdAt))}</small>{event.toolInputJson != null && <JsonEvidence value={event.toolInputJson} />}{event.toolOutputJson != null && <JsonEvidence value={event.toolOutputJson} />}</div></div>)}{!latest?.events.length && <p className="quiet padded">No agent events recorded.</p>}</div>
          </article>
          <div className="detail-stack">
            <article className="detail-panel"><div className="panel-heading"><div><span className="sequence">HUMAN CONTROL</span><h3>Review cases</h3></div><span>{reviewCases.length}</span></div><div className="compact-list">{reviewCases.map((review) => <div key={review.id}><span>#{review.id} · {label(review.status)}</span><strong>{review.proposedAction ? label(review.proposedAction) : "Awaiting decision"}</strong></div>)}{reviewCases.length === 0 && <p className="quiet padded">No review case created.</p>}</div></article>
            <article className="detail-panel"><div className="panel-heading"><div><span className="sequence">PROVENANCE</span><h3>Audit trail</h3></div><span>{auditTrail.length}</span></div><div className="compact-list">{auditTrail.map((audit) => <div key={audit.id}><span>{label(audit.actorType)} · {date.format(new Date(audit.createdAt))}</span><strong>{label(audit.action)}</strong></div>)}</div></article>
          </div>
        </section>
      </div>
    </ControlRoomShell>
  );
}
