import { redirect } from 'next/navigation';
import { getMe, has, load } from '@/lib/page';
import type { DocumentSummary, TrainingRecord, UserRow } from '@/lib/types';
import { fmtDate, fmtUtc, qs } from '@/lib/format';
import { Chip, Empty, Notice, ReportButtons } from '@/components/ui';
import { TrainingNav } from '../TrainingNav';
import { sendReminders } from '../actions';

export const metadata = { title: 'Training records' };

const STATUSES = ['Assigned', 'Overdue', 'Complete', 'Superseded', 'Withdrawn', 'Corrected', 'Correction', 'Obsolete'];

export default async function RecordsPage({ searchParams }: { searchParams: Promise<{ userId?: string; documentNumber?: string; status?: string; all?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (!has(me, 'training.org')) redirect('/training');
  const f = { userId: sp.userId ?? '', documentNumber: sp.documentNumber ?? '', status: sp.status ?? '', all: sp.all === '1' ? '1' : '' };
  const [rows, users, docs] = await Promise.all([
    load<TrainingRecord[]>(`/training/records${qs(f)}`),
    load<UserRow[]>('/users'),
    load<DocumentSummary[]>('/documents')
  ]);
  return (
    <>
      <div className="page-head"><div><h1>Training</h1><div className="sub">Every read-and-understood record. Records are locked; corrections are new records.</div></div>
        <div className="btn-row">
          <ReportButtons href={`/reports/training-records${qs(f)}`} />
          {has(me, 'training.manage') ? <form action={sendReminders}><button className="btn" type="submit">Send reminders now</button></form> : null}
        </div></div>
      <TrainingNav current="/training/records" org />
      <Notice ok={sp.ok} err={sp.err} />
      <form method="get" className="toolbar" role="search">
        <label htmlFor="f-user" className="sr-only">Person</label>
        <select className="select" id="f-user" name="userId" defaultValue={f.userId}><option value="">Anyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <label htmlFor="f-doc" className="sr-only">Document</label>
        <select className="select" id="f-doc" name="documentNumber" defaultValue={f.documentNumber}><option value="">Any document</option>{docs.map((d) => <option key={d.id} value={d.number}>{d.number} {d.title}</option>)}</select>
        <label htmlFor="f-status" className="sr-only">Status</label>
        <select className="select" id="f-status" name="status" defaultValue={f.status}><option value="">Any status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <label className="check"><input type="checkbox" name="all" value="1" defaultChecked={f.all === '1'} /> Include earlier versions</label>
        <button className="btn" type="submit">Filter</button>
        <a className="btn btn-link" href="/training/records">Clear</a>
      </form>
      {rows.length ? (
        <div className="table-wrap"><table className="t"><caption className="sr-only">Training records</caption>
          <thead><tr><th scope="col">Person</th><th scope="col">Document</th><th scope="col">Allocated</th><th scope="col">Due</th><th scope="col">Completed (UTC)</th><th scope="col">Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><a href={`/training/records/${r.id}`}>{r.user.name}</a></td>
              <td>{r.documentNumber} v{r.version}<div className="small muted">{r.title}</div></td>
              <td className="small">{fmtDate(r.assignedAt)}<div className="muted">{r.allocReason}</div></td>
              <td>{fmtDate(r.dueAt)}</td>
              <td>{r.completedAt ? fmtUtc(r.completedAt) : '—'}</td>
              <td><Chip text={r.status} /></td>
            </tr>
          ))}</tbody></table></div>
      ) : <Empty title="No records match" text="Change the filters, or include earlier versions." />}
      <p className="small muted mt-16">{rows.length} record{rows.length === 1 ? '' : 's'}.</p>
    </>
  );
}
