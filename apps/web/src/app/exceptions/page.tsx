import Link from "next/link";
import { ControlRoomShell } from "@/components/control-room-shell";
import { getExceptions } from "@/lib/api";

export const dynamic = "force-dynamic";

const statuses = ["OPEN", "AUTO_RESOLVED", "HUMAN_RESOLVED", "UNRESOLVED"];
const types = ["MISSING_SETTLEMENT", "FEE_MISMATCH", "UNKNOWN_ADJUSTMENT", "DUPLICATE_REFUND", "BANK_CREDIT_MISMATCH", "AMBIGUOUS_MATCH"];
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export default async function ExceptionsPage({ searchParams }: { searchParams: Promise<{ runId?: string; status?: string; type?: string; page?: string }> }) {
  const params = await searchParams;
  const page = params.page && /^\d+$/.test(params.page) ? Math.max(1, Number(params.page)) : 1;
  const query = new URLSearchParams({ limit: "20", offset: String((page - 1) * 20) });
  if (params.runId && /^[1-9]\d*$/.test(params.runId)) query.set("runId", params.runId);
  if (params.status && statuses.includes(params.status)) query.set("status", params.status);
  if (params.type && types.includes(params.type)) query.set("type", params.type);
  const data = await getExceptions(query);
  const pageCount = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit)) : 1;
  const pageHref = (nextPage: number) => {
    const next = new URLSearchParams();
    if (params.runId) next.set("runId", params.runId);
    if (params.status) next.set("status", params.status);
    if (params.type) next.set("type", params.type);
    next.set("page", String(nextPage));
    return `/exceptions?${next}`;
  };

  return (
    <ControlRoomShell active="Exceptions" eyebrow="SETTLEMENT OPERATIONS / EXCEPTIONS" title="Exception ledger">
      <form className="filter-bar">
        <label>Run ID<input name="runId" inputMode="numeric" defaultValue={params.runId ?? ""} placeholder="All runs" /></label>
        <label>Status<select name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label>Type<select name="type" defaultValue={params.type ?? ""}><option value="">All types</option>{types.map((type) => <option value={type} key={type}>{label(type)}</option>)}</select></label>
        <button type="submit">Apply filters</button>
        <Link href="/exceptions">Reset</Link>
      </form>

      {!data ? <section className="list-message"><h2>Exceptions are unavailable.</h2><p>Start the API and retry this page.</p></section> : (
        <section className="exception-panel">
          <div className="list-summary"><span><strong>{data.pagination.total}</strong> exceptions found</span><span>Page {page} of {pageCount}</span></div>
          <div className="exception-table" role="table" aria-label="Reconciliation exceptions">
            <div className="exception-row table-head" role="row"><span>ID / TYPE</span><span>STATUS</span><span>RISK</span><span>INVESTIGATION</span><span /></div>
            {data.items.map(({ exception, latestInvestigation }) => (
              <div className="exception-row" role="row" key={exception.id}>
                <div><strong>#{exception.id} · {label(exception.type)}</strong><small>{exception.summary ?? `Run #${exception.runId}`}</small></div>
                <span className={`exception-status ${exception.status.toLowerCase()}`}>{label(exception.status)}</span>
                <div className="risk-value"><strong>{money.format(exception.amountAtRiskPaise / 100)}</strong><small>{exception.severity} severity</small></div>
                <div><strong>{latestInvestigation?.confidence == null ? "Not investigated" : `${Math.round(latestInvestigation.confidence * 100)}% confidence`}</strong><small>{latestInvestigation?.recommendedAction ? label(latestInvestigation.recommendedAction) : "Awaiting analysis"}</small></div>
                <Link className="row-action" href={`/exceptions/${exception.id}`}>View →</Link>
              </div>
            ))}
            {data.items.length === 0 && <div className="no-results">No exceptions match these filters.</div>}
          </div>
          <div className="pagination"><Link aria-disabled={page <= 1} href={page > 1 ? pageHref(page - 1) : pageHref(1)}>← Previous</Link><span>{data.pagination.offset + 1}–{Math.min(data.pagination.offset + data.items.length, data.pagination.total)} of {data.pagination.total}</span><Link aria-disabled={page >= pageCount} href={page < pageCount ? pageHref(page + 1) : pageHref(pageCount)}>Next →</Link></div>
        </section>
      )}
    </ControlRoomShell>
  );
}
