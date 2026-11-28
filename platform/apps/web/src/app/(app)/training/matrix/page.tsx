import { redirect } from 'next/navigation';
import { getMe, has, load } from '@/lib/page';
import type { Group, Matrix, MatrixCell } from '@/lib/types';
import { chipClass, qs } from '@/lib/format';
import { Empty, ReportButtons } from '@/components/ui';
import { TrainingNav } from '../TrainingNav';

export const metadata = { title: 'Training matrix' };

const SHORT: Record<MatrixCell['status'], string> = {
  Complete: 'Done', Assigned: 'Due', Overdue: 'Overdue', Superseded: 'Old version', 'Not allocated': 'Missing', 'Not required': '—'
};

function Cell({ c }: { c: MatrixCell | null }) {
  if (!c || c.status === 'Not required') return <td className="muted" style={{ textAlign: 'center' }}>—</td>;
  const label = `${c.status}${c.versionTrained ? `, trained on v${c.versionTrained}` : ''}; current v${c.currentVersion}`;
  const chip = <span className={`chip ${chipClass(c.status)}`} title={label}>{SHORT[c.status]}{c.versionTrained && c.status !== 'Complete' ? ` v${c.versionTrained}` : ''}</span>;
  return (
    <td style={{ textAlign: 'center' }}>
      {c.recordId ? <a href={`/training/records/${c.recordId}`} aria-label={label}>{chip}</a> : <span aria-label={label}>{chip}</span>}
    </td>
  );
}

export default async function MatrixPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (!has(me, 'training.org')) redirect('/training');
  const group = sp.group ?? '';
  const [m, groups] = await Promise.all([load<Matrix>(`/training/matrix${qs({ group })}`), load<Group[]>('/groups')]);
  const counts = { done: 0, open: 0, overdue: 0, missing: 0 };
  for (const p of m.people) for (const d of m.documents) {
    const c = m.cells[p.id]?.[d.id];
    if (!c) continue;
    if (c.status === 'Complete') counts.done++;
    else if (c.status === 'Assigned') counts.open++;
    else if (c.status === 'Overdue') counts.overdue++;
    else if (c.status === 'Not allocated' || c.status === 'Superseded') counts.missing++;
  }
  return (
    <>
      <div className="page-head"><div><h1>Training</h1><div className="sub">Who has trained on the current version of each document.</div></div>
        <ReportButtons href={`/reports/training-matrix${qs({ group })}`} /></div>
      <TrainingNav current="/training/matrix" org />
      <form method="get" className="toolbar" role="search">
        <label htmlFor="f-group" className="small">Group</label>
          <select className="select" id="f-group" name="group" defaultValue={group}>
            <option value="">Everyone</option>
            {groups.map((g) => <option key={g.id} value={g.name}>{g.name} ({g.members})</option>)}
          </select>
        <button className="btn" type="submit">Show</button>
      </form>
      <div className="grid-4 mb-16">
        <div className="card kpi"><div className="kpi-label">Complete</div><div className="kpi-value">{counts.done}</div></div>
        <div className="card kpi"><div className="kpi-label">Due</div><div className="kpi-value">{counts.open}</div></div>
        <div className="card kpi"><div className="kpi-label">Overdue</div><div className="kpi-value">{counts.overdue}</div></div>
        <div className="card kpi"><div className="kpi-label">Not on current version</div><div className="kpi-value">{counts.missing}</div></div>
      </div>
      {m.people.length && m.documents.length ? (
        <div className="table-wrap"><table className="t"><caption className="sr-only">Training matrix: people by document</caption>
          <thead><tr><th scope="col">Person</th>{m.documents.map((d) => <th scope="col" key={d.id} title={d.title}><a href={`/documents/${encodeURIComponent(d.number)}?tab=training`}>{d.number}</a><div className="small muted">v{d.currentVersion}</div></th>)}</tr></thead>
          <tbody>{m.people.map((p) => (
            <tr key={p.id}><th scope="row"><a href={`/training/records${qs({ userId: p.id })}`}>{p.name}</a>{p.jobTitle ? <div className="small muted">{p.jobTitle}</div> : null}</th>
              {m.documents.map((d) => <Cell key={d.id} c={m.cells[p.id]?.[d.id] ?? null} />)}</tr>
          ))}</tbody></table></div>
      ) : <Empty title="Nothing to show" text="No one in this group has training allocated." />}
      <p className="small muted mt-16">“Old version” means the person trained on an earlier version and has not yet confirmed the current one. “Missing” means the document’s audience includes them but no record exists; tell the Quality Manager.</p>
    </>
  );
}
