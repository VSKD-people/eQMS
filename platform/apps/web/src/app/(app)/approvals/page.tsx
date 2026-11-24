import { redirect } from 'next/navigation';
import { getMe, has, load } from '@/lib/page';
import type { Allowance, AgreementSummary } from '@/lib/types';
import { fmtDate, fmtDateTime, qs, recordHref } from '@/lib/format';
import { Empty, ReportButtons, Tabs } from '@/components/ui';
import { AgreementStatus } from '@/components/agreement';

export const metadata = { title: 'Approvals and Adobe Sign' };

const STATUS = [['', 'Any status'], ['sent', 'Out for signature'], ['completed', 'Completed'], ['declined', 'Declined'], ['cancelled', 'Cancelled']] as const;

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string; year?: string; status?: string }> }) {
  const sp = await searchParams;
  const me = await getMe();
  if (!has(me, 'approvals.view')) redirect('/today');
  const tab = sp.tab === 'register' ? 'register' : 'transactions';
  const year = /^\d{4}$/.test(sp.year ?? '') ? sp.year! : '';
  const status = STATUS.some(([v]) => v === sp.status) ? sp.status ?? '' : '';
  const log = await load<{ allowance: Allowance; items: AgreementSummary[] }>(`/agreements${qs({ year, status })}`);
  const a = log.allowance;
  const register = tab === 'register' ? await load<AgreementSummary[]>('/approvals/register') : [];
  const years = [a.year, a.year - 1, a.year - 2];
  const pct = a.allowance ? Math.min(100, Math.round((a.used / a.allowance) * 100)) : 0;
  return (
    <>
      <div className="page-head"><div><h1>Approvals and Adobe Sign</h1>
        <div className="sub">Every signature except read-and-understood training is made in Adobe Sign. One agreement sent is one Adobe Sign transaction.</div></div></div>
      <div className="grid-4 mb-16">
        <div className="card kpi"><div className="kpi-label">Transactions used</div><div className="kpi-value">{a.used}</div><div className="kpi-sub">of {a.allowance} · {pct}%</div></div>
        <div className="card kpi"><div className="kpi-label">Remaining</div><div className="kpi-value">{a.remaining}</div><div className="kpi-sub">{a.exhausted ? 'Allowance used up' : a.low ? 'Running low' : 'Within allowance'}</div></div>
        <div className="card kpi"><div className="kpi-label">Allowance year</div><div className="kpi-value">{a.year}</div><div className="kpi-sub">{fmtDate(a.from)} to {fmtDate(a.to)}</div></div>
        <div className="card kpi"><div className="kpi-label">Out for signature</div><div className="kpi-value">{log.items.filter((e) => e.status === 'sent').length}</div><div className="kpi-sub">in this list</div></div>
      </div>
      {a.exhausted ? <div className="callout warn mb-16" role="alert"><strong>The Adobe Sign allowance for this year is used up.</strong> No new agreements can be sent until the allowance is raised or the next allowance year starts. Tell the Quality Manager.</div>
        : a.low ? <div className="callout mb-16" role="status"><strong>{a.remaining} transactions left this allowance year.</strong> Check before sending anything that isn’t ready.</div> : null}
      <Tabs base="/approvals" current={tab} tabs={[['transactions', 'Transactions log'], ['register', 'Approvals register']]} />
      {tab === 'transactions' ? (
        <>
          <form method="get" className="toolbar" role="search">
            <input type="hidden" name="tab" value="transactions" />
            <label htmlFor="f-year" className="sr-only">Allowance year</label>
            <select className="select" id="f-year" name="year" defaultValue={year}><option value="">Current year</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <label htmlFor="f-status" className="sr-only">Status</label>
            <select className="select" id="f-status" name="status" defaultValue={status}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button className="btn" type="submit">Filter</button>
            <span style={{ flex: 1 }} />
            <ReportButtons href={`/reports/signing-transactions${qs({ year, status })}`} />
          </form>
          {log.items.length ? (
            <div className="table-wrap"><table className="t"><caption className="sr-only">Adobe Sign transactions</caption>
              <thead><tr><th scope="col">Transaction</th><th scope="col">Record</th><th scope="col">Purpose</th><th scope="col">Sent</th><th scope="col">Signed</th><th scope="col">Status</th></tr></thead>
              <tbody>{log.items.map((e) => (
                <tr key={e.id}>
                  <td><a href={`/approvals/${e.id}`}>#{e.transactionNo}</a><div className="small muted">{e.allowanceYear}</div></td>
                  <td><a href={recordHref(e.recordType, e.recordNumber)}>{e.recordNumber}</a>{e.version ? ` v${e.version}` : ''}<div className="small muted">{e.subject}</div></td>
                  <td className="small">{e.purpose}{e.correctionOf ? <div className="muted">Correction</div> : null}</td>
                  <td className="small">{fmtDateTime(e.sentAt)}<div className="muted">{e.sentBy.name}</div></td>
                  <td>{e.signed} of {e.signers.length}</td>
                  <td><AgreementStatus e={e} /></td>
                </tr>
              ))}</tbody></table></div>
          ) : <Empty title="No transactions match" text="Change the filters to see others." />}
        </>
      ) : (
        <>
          <div className="toolbar"><span className="small muted">Completed approvals, newest first. Approvals made before go-live are marked as migrated.</span><span style={{ flex: 1 }} /><ReportButtons href="/reports/approvals-register" /></div>
          {register.length ? (
            <div className="table-wrap"><table className="t"><caption className="sr-only">Approvals register</caption>
              <thead><tr><th scope="col">Record</th><th scope="col">Approved</th><th scope="col">Signers</th><th scope="col">Adobe Sign agreement ID</th><th scope="col">Files</th></tr></thead>
              <tbody>{register.map((e) => (
                <tr key={e.id}>
                  <td><a href={recordHref(e.recordType, e.recordNumber)}>{e.recordNumber}</a>{e.version ? ` v${e.version}` : ''}<div className="small muted">{e.subject}</div></td>
                  <td className="small">{fmtDateTime(e.completedAt)}</td>
                  <td className="small">{e.signers.slice().sort((x, y) => x.routingOrder - y.routingOrder).map((s) => `${s.name} (${s.meaning})`).join(', ')}</td>
                  <td className="small"><code>{e.providerAgreementId ?? 'Migrated'}</code></td>
                  <td><a href={`/approvals/${e.id}`}>Details</a></td>
                </tr>
              ))}</tbody></table></div>
          ) : <Empty title="No completed approvals yet" />}
        </>
      )}
    </>
  );
}
