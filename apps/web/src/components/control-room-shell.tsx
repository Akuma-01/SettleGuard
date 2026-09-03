import Link from "next/link";
import type { ReactNode } from "react";
import { getApiHealth } from "@/lib/api";

const navigation = [
  { label: "Overview", index: "01", href: "/" },
  { label: "Exceptions", index: "02", href: "/exceptions" },
  { label: "Open exceptions", index: "03", href: "/exceptions?status=OPEN" },
  { label: "Audit trail", index: "04", href: "/audit" },
];

export async function ControlRoomShell({ active, eyebrow, title, actions, children }: { active: string; eyebrow: string; title: string; actions?: ReactNode; children: ReactNode }) {
  const health = await getApiHealth();
  return (
    <main className="control-room">
      <aside className="sidebar">
        <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">SG</span><div><strong>SettleGuard</strong><span>Finance control room</span></div></Link>
        <nav aria-label="Primary navigation">{navigation.map((item) => <Link className={active === item.label ? "nav-item active" : "nav-item"} href={item.href} key={item.label}><span>{item.index}</span>{item.label}</Link>)}</nav>
        <div className="sidebar-foot"><span className={health ? "status-dot online" : "status-dot"} /><div><strong>{health ? "Systems operational" : "API unavailable"}</strong><span>{health ? `${health.service} · v${health.version}` : "Start the API on port 4000"}</span></div></div>
      </aside>
      <section className="workspace">
        <header className="topbar"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{actions}</header>
        {children}
      </section>
    </main>
  );
}
