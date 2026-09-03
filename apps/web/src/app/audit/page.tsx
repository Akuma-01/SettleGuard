import Link from "next/link";
import { ControlRoomShell } from "@/components/control-room-shell";
import { getAuditEntries } from "@/lib/api";

export const dynamic = "force-dynamic";
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
const date = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium" });
const safeFilter = (value: string | undefined) => value && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ actorType?: string; action?: string; entityType?: string; entityId?: string; page?: string }> }) {
  const params = await searchParams;
  const page = params.page && /^\d+$/.test(params.page) ? Math.max(1, Number(params.page)) : 1;
  const query = new URLSearchParams({ limit: "25", offset: String((page - 1) * 25) });
  const filters = {
    actorType: safeFilter(params.actorType), action: safeFilter(params.action),
    entityType: safeFilter(params.entityType),
    entityId: params.entityId && /^[1-9]\d*$/.test(params.entityId) ? params.entityId : null,
  };
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
  const data = await getAuditEntries(query);
  const pageCount = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit)) : 1;
  const pageHref = (nextPage: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value);
    next.set("page", String(nextPage));
    return `/audit?${next}`;
  };

  return (
    <ControlRoomShell active="Audit trail" eyebrow="GOVERNANCE / AUDIT TRAIL" title="Control history">
      <form className="filter-bar audit-filters">
        <label>Actor<select name="actorType" defaultValue={filters.actorType ?? ""}><option value="">All actors</option><option value="system">System</option><option value="agent">Agent</option><option value="human">Human</option></select></label>
        <label>Action<input name="action" defaultValue={filters.action ?? ""} pattern="[A-Za-z0-9_-]+" placeholder="Any action" /></label>
        <label>Entity type<input name="entityType" defaultValue={filters.entityType ?? ""} pattern="[A-Za-z0-9_-]+" placeholder="Any entity" /></label>
        <label>Entity ID<input name="entityId" inputMode="numeric" defaultValue={filters.entityId ?? ""} pattern="[1-9][0-9]*" placeholder="Any ID" /></label>
        <button type="submit">Apply filters</button><Link href="/audit">Reset</Link>
      </form>

      {!data ? <section className="list-message"><h2>Audit history is unavailable.</h2><p>Start the API and retry this page.</p></section> : <section className="audit-panel">
        <div className="list-summary"><span><strong>{data.pagination.total}</strong> immutable events</span><span>Newest first · Page {page} of {pageCount}</span></div>
        <div className="audit-list">
          {data.items.map((entry) => <article className="audit-entry" key={entry.id}>
            <span className={`actor-mark ${entry.actorType}`}>{entry.actorType.slice(0, 1).toUpperCase()}</span>
            <div className="audit-copy"><span>{date.format(new Date(entry.createdAt))} · EVENT #{entry.id}</span><strong>{label(entry.action)}</strong><small>{label(entry.actorType)}{entry.actorId ? ` (${entry.actorId})` : ""} acted on {label(entry.entityType)}{entry.entityId ? ` #${entry.entityId}` : ""}</small></div>
            {(entry.beforeJson != null || entry.afterJson != null || entry.metadataJson != null) && <details><summary>Payload</summary><pre>{JSON.stringify({ before: entry.beforeJson, after: entry.afterJson, metadata: entry.metadataJson }, null, 2)}</pre></details>}
          </article>)}
          {data.items.length === 0 && <div className="no-results">No audit events match these filters.</div>}
        </div>
        <div className="pagination"><Link aria-disabled={page <= 1} href={page > 1 ? pageHref(page - 1) : pageHref(1)}>← Previous</Link><span>{data.pagination.total === 0 ? 0 : data.pagination.offset + 1}–{Math.min(data.pagination.offset + data.items.length, data.pagination.total)} of {data.pagination.total}</span><Link aria-disabled={page >= pageCount} href={page < pageCount ? pageHref(page + 1) : pageHref(pageCount)}>Next →</Link></div>
      </section>}
    </ControlRoomShell>
  );
}
