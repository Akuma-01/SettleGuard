import { ControlRoomShell } from "@/components/control-room-shell";
import { getRunDashboard, type DashboardResult } from "@/lib/api";
import { runDemoAction } from "./actions";

export const dynamic = "force-dynamic";

const integer = new Intl.NumberFormat("en-IN");
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

function EmptyDashboard({ result }: { result: DashboardResult | null }) {
  const unavailable = result?.status === "unavailable";
  const notFound = result?.status === "not_found";
  return (
    <section className="empty-state">
      <span className="sequence">{unavailable ? "CONNECTION ERROR" : notFound ? "RUN NOT FOUND" : "LIVE RUN DATA"}</span>
      <div className="empty-icon" aria-hidden="true"><span /><span /><span /></div>
      <h2>{unavailable ? "The API could not be reached." : notFound ? "That reconciliation run does not exist." : "Choose a reconciliation run."}</h2>
      <p>{unavailable ? "Confirm the API is running on API_BASE_URL, then try again." : notFound ? "Check the run ID returned by reconciliation and try again." : "Enter a run ID to load measured records, match rate, exceptions, and resolution outcomes."}</p>
    </section>
  );
}

function Dashboard({ result }: { result: Extract<DashboardResult, { status: "ready" }> }) {
  const { context, metrics } = result;
  const run = context.run;
  const matchPercent = metrics.records.matchRate * 100;
  const assessed = metrics.resolutions.autoResolved + metrics.resolutions.humanReview + metrics.resolutions.unresolved;

  return (
    <div className="dashboard">
      <section className="run-banner">
        <div><span className="sequence">RUN #{run.id} · BATCH #{run.batchId}</span><h2>{run.batchName}</h2><p>{run.merchantName}</p></div>
        <span className={`run-status ${run.status}`}>{label(run.status)}</span>
      </section>

      <section className="metric-grid" aria-label="Reconciliation metrics">
        <article className="metric-card featured"><span>Match rate</span><strong>{matchPercent.toFixed(2)}%</strong><div className="progress-track"><span style={{ width: `${Math.min(100, matchPercent)}%` }} /></div><small>{integer.format(metrics.records.matched)} of {integer.format(metrics.records.total)} records matched</small></article>
        <article className="metric-card"><span>Total records</span><strong>{integer.format(metrics.records.total)}</strong><small>{integer.format(metrics.records.unmatched)} unmatched</small></article>
        <article className="metric-card risk"><span>Amount at risk</span><strong>{money.format(metrics.exceptions.amountAtRiskPaise / 100)}</strong><small>Open and unresolved exceptions</small></article>
        <article className="metric-card"><span>Exceptions</span><strong>{integer.format(metrics.exceptions.total)}</strong><small>{Object.keys(context.exceptionsByType).length} detected categories</small></article>
      </section>

      <section className="dashboard-lower">
        <article className="data-panel">
          <div className="panel-heading"><div><span className="sequence">BREAKDOWN</span><h3>Exceptions by type</h3></div><span>{metrics.exceptions.total} total</span></div>
          <div className="breakdown-list">
            {Object.entries(context.exceptionsByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => <div className="breakdown-row" key={type}><span>{label(type)}</span><div><i style={{ width: `${metrics.exceptions.total ? (count / metrics.exceptions.total) * 100 : 0}%` }} /></div><strong>{count}</strong></div>)}
            {Object.keys(context.exceptionsByType).length === 0 && <p className="quiet">No exceptions detected in this run.</p>}
          </div>
        </article>
        <article className="data-panel">
          <div className="panel-heading"><div><span className="sequence">POLICY OUTCOMES</span><h3>Resolution routing</h3></div><span>{assessed} assessed</span></div>
          <div className="resolution-list">
            <div><span className="resolution-swatch auto" /><p>Auto-resolved<small>Policy-approved</small></p><strong>{metrics.resolutions.autoResolved}</strong></div>
            <div><span className="resolution-swatch review" /><p>Human review<small>Approval required</small></p><strong>{metrics.resolutions.humanReview}</strong></div>
            <div><span className="resolution-swatch unresolved" /><p>Unresolved<small>Evidence insufficient</small></p><strong>{metrics.resolutions.unresolved}</strong></div>
          </div>
        </article>
      </section>
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<{ runId?: string; notice?: string; error?: string }> }) {
  const { runId, notice, error } = await searchParams;
  const parsedRunId = runId && /^[1-9]\d*$/.test(runId) && Number.isSafeInteger(Number(runId)) ? Number(runId) : null;
  const result = parsedRunId ? await getRunDashboard(parsedRunId) : null;

  return (
    <ControlRoomShell active="Overview" eyebrow="SETTLEMENT OPERATIONS / OVERVIEW" title="Reconciliation control room" actions={<div className="dashboard-actions"><form action={runDemoAction}><button className="demo-button" type="submit">Run demo</button></form><form className="run-selector"><label htmlFor="runId">Run ID</label><input id="runId" name="runId" inputMode="numeric" pattern="[1-9][0-9]*" defaultValue={parsedRunId ?? ""} placeholder="e.g. 1" required /><button type="submit">Load run</button></form></div>}>
        {(notice || error) && <div className={error ? "action-feedback error dashboard-feedback" : "action-feedback dashboard-feedback"}>{error ?? notice}</div>}
        {result?.status === "ready" ? <Dashboard result={result} /> : <EmptyDashboard result={result} />}
    </ControlRoomShell>
  );
}
