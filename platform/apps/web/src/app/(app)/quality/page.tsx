import { load } from '@/lib/page';
import type { ClosureRecord } from '@/lib/types';
import { fmtUtc } from '@/lib/format';
import { Chip, Empty, Notice } from '@/components/ui';
import { openRecord } from './actions';

export const metadata = { title: 'Quality' };

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  const [capas, events] = await Promise.all([load<ClosureRecord[]>('/capas'), load<ClosureRecord[]>('/quality-events')]);
  const envNote = (r: ClosureRecord) => (r.agreement?.status === 'sent' ? `Adobe Sign · ${r.agreement.signed} of ${r.agreement.signers.length} signed` : '');
  return (
    <>
      <div className="page-head"><div><h1>Quality events and CAPA</h1><div className="sub">Phase 1: closing CAPAs and deviations through Adobe Sign. The full module arrives in Phase 3.</div></div></div>
      <Notice err={sp.err} />
      <div className="card card-pad mb-16">
        <p>CAPAs waiting for their effectiveness result and deviations ready to close also appear on <a href="/today">Today</a>. Open one from the lists below, or by number.</p>
        <form action={openRecord} className="row-wrap">
          <label className="sr-only" htmlFor="num">Record number</label>
          <input className="input" id="num" name="number" placeholder="CAPA-005 or QE-017" style={{ maxWidth: 240 }} required />
          <button className="btn" type="submit">Open</button>
        </form>
      </div>
      <h2 className="label mb-8">CAPAs · {capas.length}</h2>
      {capas.length ? (
        <div className="table-wrap mb-16"><table className="t"><caption className="sr-only">CAPAs</caption>
          <thead><tr><th scope="col">CAPA</th><th scope="col">Title</th><th scope="col">Owner</th><th scope="col">State</th><th scope="col">Closed (UTC)</th></tr></thead>
          <tbody>{capas.map((c) => (
            <tr key={c.id}><td><a href={`/quality/capas/${encodeURIComponent(c.number)}`}>{c.number}</a></td><td>{c.title}</td><td>{c.owner.name}</td>
              <td><Chip text={c.state} cls={c.state === 'Closed' ? 'chip-done' : 'chip-outline'} /> <span className="small muted">{envNote(c)}</span></td><td>{fmtUtc(c.closedAt)}</td></tr>
          ))}</tbody></table></div>
      ) : <Empty title="No CAPAs" />}
      <h2 className="label mb-8">Quality events · {events.length}</h2>
      {events.length ? (
        <div className="table-wrap"><table className="t"><caption className="sr-only">Quality events</caption>
          <thead><tr><th scope="col">Event</th><th scope="col">Type</th><th scope="col">Title</th><th scope="col">Owner</th><th scope="col">State</th><th scope="col">Closed (UTC)</th></tr></thead>
          <tbody>{events.map((q) => (
            <tr key={q.id}><td><a href={`/quality/events/${encodeURIComponent(q.number)}`}>{q.number}</a></td><td>{q.type}</td><td>{q.title}</td><td>{q.owner.name}</td>
              <td><Chip text={q.state} cls={q.state === 'Closed' ? 'chip-done' : 'chip-outline'} /> <span className="small muted">{envNote(q)}</span></td><td>{fmtUtc(q.closedAt)}</td></tr>
          ))}</tbody></table></div>
      ) : <Empty title="No quality events" />}
    </>
  );
}
