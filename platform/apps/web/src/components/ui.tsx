import { chipClass, relDue, fmtDate } from '@/lib/format';

export function Chip({ text, cls }: { text: string; cls?: string }) {
  return <span className={`chip ${cls ?? chipClass(text)}`}>{text}</span>;
}

export function DueChip({ iso }: { iso: string | null | undefined }) {
  const r = relDue(iso);
  return <span className={`chip ${r.cls}`} title={iso ? fmtDate(iso) : undefined}>{r.text}</span>;
}

export function Cls({ c }: { c: string }) {
  return <span className={`cls cls-${c.toLowerCase()}`} title={`Classification: ${c}`}>{c}</span>;
}

export function Stepper({ states, current, labels }: { states: string[]; current: string; labels?: Record<string, string> }) {
  const all = current === states[states.length - 1];
  const ci = all ? states.length : states.indexOf(current);
  return (
    <ol className="stepper" aria-label="Lifecycle" style={{ listStyle: 'none', margin: 0 }}>
      {states.map((s, i) => {
        const st = i < ci ? 'done' : i === ci ? 'current' : '';
        return (
          <li key={s} className={`step ${st}`} aria-current={i === ci ? 'step' : undefined}>
            <div className="step-bar" />
            <div className="step-name">{labels?.[s] ?? s}</div>
            <span className="sr-only">{st === 'done' ? ' (done)' : st === 'current' ? ' (current)' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Messages passed back from Server Actions in the query string (?ok=… or ?err=…).
export function Notice({ ok, err }: { ok?: string; err?: string }) {
  if (err) return <div className="callout warn mb-16" role="alert"><strong>Not done.</strong> {err}</div>;
  if (ok) return <div className="callout ok mb-16" role="status">{ok}</div>;
  return null;
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return <div className="empty"><h3>{title}</h3>{text ? <p>{text}</p> : null}</div>;
}

export function Tabs({ base, current, tabs, extra }: { base: string; current: string; tabs: [string, string][]; extra?: string }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map(([id, label]) => (
        <a key={id} className={`tab ${current === id ? 'active' : ''}`} aria-current={current === id ? 'page' : undefined}
          href={`${base}?tab=${id}${extra ?? ''}`}>{label}</a>
      ))}
    </nav>
  );
}

export function ReportButtons({ href }: { href: string }) {
  // href without extension, e.g. /reports/training-matrix?group=IT%20team
  const [path, query] = href.split('?');
  const q = query ? `?${query}` : '';
  return (
    <div className="btn-row">
      <a className="btn" href={`${path}.pdf${q}`}>Export PDF</a>
      <a className="btn" href={`${path}.xlsx${q}`}>Export Excel</a>
    </div>
  );
}
