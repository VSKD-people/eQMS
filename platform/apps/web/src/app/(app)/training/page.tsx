import { getMe, has, load } from '@/lib/page';
import type { TrainingRecord } from '@/lib/types';
import { fmtUtc } from '@/lib/format';
import { Chip, DueChip, Empty, Notice } from '@/components/ui';
import { TrainingNav } from './TrainingNav';

export const metadata = { title: 'Training' };

export default async function MyTrainingPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const me = await getMe();
  const { open, history } = await load<{ open: TrainingRecord[]; history: TrainingRecord[] }>('/training/my');
  return (
    <>
      <div className="page-head"><div><h1>Training</h1><div className="sub">Read and understood. Records are dated by the system, locked once made, and kept with the person.</div></div></div>
      <TrainingNav current="/training" org={has(me, 'training.org')} />
      <Notice ok={sp.ok} err={sp.err} />
      <h2 className="label mb-8">To do · {open.length}</h2>
      {open.length ? open.map((r) => (
        <div className="card card-pad mb-8" key={r.id}>
          <div className="spread" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div><div className="row-wrap small muted">Read and understood · {r.allocReason} · allocated by {r.allocatedBy?.name ?? 'System'} <DueChip iso={r.dueAt} /></div>
              <div style={{ fontWeight: 600, marginTop: 4 }}>{r.documentNumber} {r.title} v{r.version}</div></div>
            <a className="btn btn-primary" href={`/training/${r.id}`}>Start</a>
          </div>
        </div>
      )) : <Empty title="No training due" text="When a document you must train on changes, the new version shows up here." />}
      <h2 className="label mt-24 mb-8">My training record · {history.length}</h2>
      <div className="table-wrap"><table className="t"><caption className="sr-only">My training record</caption>
        <thead><tr><th scope="col">Document</th><th scope="col">Why</th><th scope="col">Completed (UTC)</th><th scope="col">Status</th></tr></thead>
        <tbody>{history.length ? history.map((r) => (
          <tr key={r.id}><td>{r.documentNumber} {r.title} v{r.version}</td><td className="small">{r.allocReason}</td><td>{r.completedAt ? fmtUtc(r.completedAt) : '—'}</td><td><Chip text={r.status} /></td></tr>
        )) : <tr><td colSpan={4}><div className="empty">No records yet.</div></td></tr>}</tbody></table></div>
    </>
  );
}
