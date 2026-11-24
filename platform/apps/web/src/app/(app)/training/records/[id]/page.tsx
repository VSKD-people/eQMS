import { getMe, has, loadOrNull } from '@/lib/page';
import type { AuditEntry, TrainingRecord } from '@/lib/types';
import { fmtDate, fmtUtc } from '@/lib/format';
import { Chip, Notice } from '@/components/ui';
import { recordCorrection } from '../../actions';

export const metadata = { title: 'Training record' };

const LIST = { listStyle: 'none', padding: 0, margin: 0 } as const;

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

// Old → new for each field the audit entry changed.
function Changes({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  if (!keys.length) return <span className="muted">—</span>;
  return <ul className="small" style={LIST}>{keys.map((k) => <li key={k}><strong>{k}</strong>: {show(b[k])} → {show(a[k])}</li>)}</ul>;
}

export default async function RecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  const data = await loadOrNull<{ record: TrainingRecord; corrections: TrainingRecord[]; audit: AuditEntry[] }>(`/training/records/${encodeURIComponent(id)}`);
  if (!data) return <div className="card card-pad"><h1>Record not available</h1><p className="muted">It doesn’t exist, or you don’t have access to it.</p><a className="btn" href="/training">Back to Training</a></div>;
  const { record: r, corrections, audit } = data;
  const canCorrect = has(me, 'training.manage') && r.status === 'Complete';
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/training">Training</a><span>/</span>{has(me, 'training.org') ? <><a href="/training/records">Records</a><span>/</span></> : null}<span>{r.user.name} · {r.documentNumber} v{r.version}</span></nav>
      <div className="page-head"><div><h1>{r.documentNumber} {r.title} v{r.version}</h1><div className="sub">{r.user.name} · <Chip text={r.status} /></div></div></div>
      <Notice ok={sp.ok} err={sp.err} />
      <div className="grid-2">
        <section className="card card-pad" aria-labelledby="rec-h"><h2 id="rec-h" className="label mb-8">Record</h2>
          <dl className="dl">
            <div><dt>Trainee</dt><dd>{r.user.name}</dd></div>
            <div><dt>Document</dt><dd><a href={`/documents/${encodeURIComponent(r.documentNumber)}`}>{r.documentNumber}</a>, version {r.version}</dd></div>
            <div><dt>Allocated</dt><dd>{fmtDate(r.assignedAt)} by {r.allocatedBy?.name ?? 'System'} ({r.allocReason})</dd></div>
            <div><dt>Due</dt><dd>{fmtDate(r.dueAt)}</dd></div>
            <div><dt>Completed (UTC, system time)</dt><dd>{r.completedAt ? fmtUtc(r.completedAt) : '—'}</dd></div>
            <div><dt>Statement</dt><dd>{r.statement ?? '—'}</dd></div>
            <div><dt>Knowledge check</dt><dd>{r.quizResult ?? 'None'}</dd></div>
            <div><dt>Confirmed via</dt><dd>{r.via ?? '—'}</dd></div>
            {r.correctionOf ? <div><dt>Corrects</dt><dd><a href={`/training/records/${r.correctionOf}`}>Earlier record</a>: {r.correctionReason}{r.noRetrain ? ' (no retraining)' : ''}</dd></div> : null}
            {r.closedAt ? <div><dt>Closed</dt><dd>{fmtUtc(r.closedAt)} · {r.closedReason}</dd></div> : null}
          </dl>
          <p className="small muted mt-16">This record is locked. Nobody can edit or delete it. Corrections are added as new records that point back to it.</p>
        </section>
        <section className="card card-pad" aria-labelledby="cor-h"><h2 id="cor-h" className="label mb-8">Corrections · {corrections.length}</h2>
          {corrections.length ? <ul style={LIST}>{corrections.map((c) => <li key={c.id} className="mb-8"><a href={`/training/records/${c.id}`}>{fmtDate(c.assignedAt)} · <Chip text={c.status} /></a><div className="small muted">{c.correctionReason}</div></li>)}</ul> : <p className="muted">None.</p>}
          {canCorrect ? (
            <form action={recordCorrection.bind(null, r.id)} className="stack mt-16">
              <h3 className="label">Record a correction</h3>
              <p className="small muted">Use this when the record is wrong, for example the wrong person confirmed. The original stays as it is, marked Corrected.</p>
              <div className="field"><label htmlFor="cor-reason">Reason (logged)</label><textarea className="textarea" id="cor-reason" name="reason" required minLength={10} rows={3} /></div>
              <fieldset><legend className="small">What happens next</legend>
                <label className="check"><input type="radio" name="mode" value="retrain" defaultChecked /> Allocate the training again to {r.user.name}</label>
                <label className="check"><input type="radio" name="mode" value="void" /> No retraining needed</label>
              </fieldset>
              <button className="btn" type="submit">Record correction</button>
            </form>
          ) : null}
        </section>
      </div>
      <section className="card card-pad mt-24" aria-labelledby="aud-h"><h2 id="aud-h" className="label mb-8">Audit trail</h2>
        <div className="table-wrap"><table className="t"><caption className="sr-only">Audit trail for this record</caption>
          <thead><tr><th scope="col">When (UTC)</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Change (old → new)</th></tr></thead>
          <tbody>{audit.length ? audit.map((a) => (
            <tr key={a.seq}><td className="nowrap">{fmtUtc(a.at)}</td><td>{a.actor}</td><td>{a.action}<div className="small muted">{a.summary}</div></td><td><Changes before={a.before} after={a.after} /></td></tr>
          )) : <tr><td colSpan={4}><div className="empty">No entries.</div></td></tr>}</tbody></table></div>
      </section>
    </>
  );
}
