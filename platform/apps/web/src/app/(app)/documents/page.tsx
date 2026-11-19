import { load, getMe, has } from '@/lib/page';
import type { DocumentSummary } from '@/lib/types';
import { DOC_TYPES } from '@veqms/domain';
import { fmtDate, qs } from '@/lib/format';
import { Chip, Cls, Notice } from '@/components/ui';

export const metadata = { title: 'Documents' };
const STATES = ['Draft', 'In review', 'Review closed', 'In approval', 'Effective', 'Superseded', 'Obsolete'];

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string; state?: string; type?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const me = await getMe();
  const docs = await load<DocumentSummary[]>(`/documents${qs({ q: sp.q, state: sp.state, type: sp.type })}`);
  return (
    <>
      <div className="page-head"><div><h1>Documents</h1><div className="sub">Controlled documents register · {docs.length} shown</div></div>
        {has(me, 'doc.create') ? <a className="btn btn-primary" href="/documents/new">New document</a> : null}</div>
      <Notice ok={sp.ok} err={sp.err} />
      <form className="toolbar" role="search" method="get">
        <label className="sr-only" htmlFor="q">Search</label>
        <input className="input search" id="q" name="q" type="search" placeholder="Search ID or title" defaultValue={sp.q ?? ''} />
        <label className="sr-only" htmlFor="type">Type</label>
        <select className="select" id="type" name="type" defaultValue={sp.type ?? ''}><option value="">All types</option>{DOC_TYPES.map((t) => <option key={t.type}>{t.type}</option>)}</select>
        <label className="sr-only" htmlFor="state">State</label>
        <select className="select" id="state" name="state" defaultValue={sp.state ?? ''}><option value="">All states</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn" type="submit">Filter</button>
      </form>
      <div className="table-wrap"><table className="t"><caption className="sr-only">Documents register</caption>
        <thead><tr><th scope="col">ID</th><th scope="col">Title</th><th scope="col">Type</th><th scope="col">State</th><th scope="col">Version</th><th scope="col">Class</th><th scope="col">Owner</th><th scope="col">Last modified</th></tr></thead>
        <tbody>{docs.length ? docs.map((d) => (
          <tr key={d.id}>
            <td className="id"><a href={`/documents/${d.number}`}>{d.number}</a></td><td><a href={`/documents/${d.number}`}>{d.title}</a></td><td>{d.docType}</td>
            <td><Chip text={d.state} /></td>
            <td>v{d.currentVersion}{d.effectiveVersion && d.effectiveVersion !== d.currentVersion ? <span className="muted small"> · v{d.effectiveVersion} effective</span> : null}</td>
            <td><Cls c={d.classification} /></td><td>{d.owner.name}</td><td>{fmtDate(d.updatedAt)}</td>
          </tr>
        )) : <tr><td colSpan={8}><div className="empty">No documents match these filters.</div></td></tr>}</tbody>
      </table></div>
    </>
  );
}
