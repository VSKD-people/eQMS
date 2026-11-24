import { Notice } from '@/components/ui';
import { openRecord } from './actions';

export const metadata = { title: 'Quality' };

export default async function QualityPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <div className="page-head"><div><h1>Quality events and CAPA</h1><div className="sub">Phase 1: closing CAPAs and deviations through DocuSign. The full module arrives in Phase 2.</div></div></div>
      <Notice err={sp.err} />
      <div className="card card-pad">
        <p>CAPAs waiting for their effectiveness result and deviations ready to close appear on <a href="/today">Today</a>. You can also open one by number.</p>
        <form action={openRecord} className="row-wrap">
          <label className="sr-only" htmlFor="num">Record number</label>
          <input className="input" id="num" name="number" placeholder="CAPA-005 or QE-017" style={{ maxWidth: 240 }} required />
          <button className="btn" type="submit">Open</button>
        </form>
      </div>
    </>
  );
}
