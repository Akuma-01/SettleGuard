import { getApiHealth } from "@/lib/api";

export const dynamic = "force-dynamic";

const navigation = [
  { label: "Overview", index: "01", active: true },
  { label: "Exceptions", index: "02", active: false },
  { label: "Review queue", index: "03", active: false },
  { label: "Audit trail", index: "04", active: false },
];

export default async function Home() {
  const health = await getApiHealth();

  return (
    <main className="control-room">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">SG</span>
          <div>
            <strong>SettleGuard</strong>
            <span>Finance control room</span>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          {navigation.map((item) => (
            <div className={item.active ? "nav-item active" : "nav-item"} key={item.index}>
              <span>{item.index}</span>
              {item.label}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <span className={health ? "status-dot online" : "status-dot"} />
          <div>
            <strong>{health ? "Systems operational" : "API unavailable"}</strong>
            <span>{health ? `${health.service} · v${health.version}` : "Start the API on port 4000"}</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">SETTLEMENT OPERATIONS / OVERVIEW</span>
            <h1>Reconciliation control room</h1>
          </div>
          <div className="environment"><span /> DEMO ENVIRONMENT</div>
        </header>

        <section className="empty-state">
          <span className="sequence">PHASE 07 · CONTROL ROOM</span>
          <div className="empty-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h2>The operational surface is ready.</h2>
          <p>
            Connect a reconciliation run to populate measured records, match rate,
            exceptions, and amount at risk. No placeholder financial metrics are shown.
          </p>
          <div className="foundation-tags" aria-label="Available backend capabilities">
            <span>CSV ingestion</span>
            <span>Deterministic matching</span>
            <span>AI investigation</span>
            <span>Human review</span>
          </div>
        </section>
      </section>
    </main>
  );
}
