import { getMe, has, loadOrNull } from '@/lib/page';
import type { Agreement } from '@/lib/types';
import { AGREEMENT_STATUS, fmtDateTime, fmtUtc, recordHref } from '@/lib/format';
import { Notice } from '@/components/ui';
import { AgreementFiles, AgreementStatus, SignerList } from '@/components/agreement';
import { MockSignPanel } from '@/components/MockSign';
import { refreshStatus, cancelFromDetails } from '../actions';

export const metadata = { title: 'Agreement details' };

const SOURCE: Record<string, string> = { app: 'VeQMS', webhook: 'Adobe Sign webhook', poll: 'Status check' };

export default async function AgreementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  const e = await loadOrNull<Agreement>(`/agreements/${encodeURIComponent(id)}`);
  if (!e) return <div className="card card-pad"><h1>Agreement not available</h1><p className="muted">It doesn’t exist, or you don’t have access to it.</p><a className="btn" href="/approvals">Back to Approvals</a></div>;
  const open = e.status === 'sent';
  const canAct = has(me, 'esign.send');
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/approvals">Approvals and Adobe Sign</a><span>/</span><span>Transaction #{e.transactionNo} · {e.allowanceYear}</span></nav>
      <div className="page-head">
        <div><h1>{e.subject}</h1>
          <div className="sub row-wrap"><AgreementStatus e={e} /> <a href={recordHref(e.recordType, e.recordNumber)}>{e.recordNumber}{e.version ? ` v${e.version}` : ''}</a> · {e.purpose}</div></div>
        <div className="btn-row">
          <AgreementFiles e={e} />
          {open && canAct ? <form action={refreshStatus.bind(null, e.id)}><button className="btn btn-sm" type="submit">Check status with Adobe Sign</button></form> : null}
        </div>
      </div>
      <Notice ok={sp.ok} err={sp.err} />
      {e.provider === 'simulated' ? <div className="callout warn mb-16" role="note"><strong>Simulated, not Part 11.</strong> Adobe Sign wasn’t connected when this was signed, so its signatures, signed PDF and audit report are stand-ins. Sign the record again through Adobe Sign before relying on it.</div> : null}
      <MockSignPanel e={e} me={me} back={`/approvals/${e.id}`} />
      {e.reason ? <div className="callout mb-16"><strong>{AGREEMENT_STATUS[e.status]}:</strong> {e.reason}</div> : null}
      <div className="grid-2">
        <section className="card card-pad" aria-labelledby="sig-h"><h2 id="sig-h" className="label mb-8">Signers, in order</h2>
          <SignerList signers={e.signers} />
          <p className="small muted mt-16">Signers sign from the Adobe Sign email. Adobe Sign checks each signer’s identity at signing and records their reason for signing in the audit report. VeQMS shows status only; it never signs for anyone.</p>
        </section>
        <section className="card card-pad" aria-labelledby="env-h"><h2 id="env-h" className="label mb-8">Agreement</h2>
          <dl className="dl">
            <div><dt>Adobe Sign agreement ID</dt><dd><code>{e.providerAgreementId ?? 'Not issued (migrated record)'}</code></dd></div>
            <div><dt>Transaction</dt><dd>#{e.transactionNo} of the {e.allowanceYear} allowance</dd></div>
            <div><dt>Sent</dt><dd>{fmtDateTime(e.sentAt)} by {e.sentBy.name}</dd></div>
            <div><dt>Completed</dt><dd>{fmtDateTime(e.completedAt)}</dd></div>
            {e.correctionOf ? <div><dt>Corrects</dt><dd><a href={`/approvals/${e.correctionOf}`}>Earlier agreement</a></dd></div> : null}
            <div><dt>Sent PDF (SHA-256)</dt><dd><code className="small" style={{ wordBreak: 'break-all' }}>{e.files.original.sha256}</code></dd></div>
            {e.files.signed ? <div><dt>Signed PDF (SHA-256)</dt><dd><code className="small" style={{ wordBreak: 'break-all' }}>{e.files.signed.sha256}</code></dd></div> : null}
            {e.files.auditReport ? <div><dt>Audit report (SHA-256)</dt><dd><code className="small" style={{ wordBreak: 'break-all' }}>{e.files.auditReport.sha256}</code></dd></div> : null}
          </dl>
        </section>
      </div>
      <section className="card card-pad mt-24" aria-labelledby="ver-h"><h2 id="ver-h" className="label mb-8">Verification before sending</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Footer shows the document number, version and classification</li>
          <li>Version on the PDF matches the record</li>
          <li>Document ID matches the record</li>
          <li>Dates on the PDF are correct</li>
        </ul>
        <p className="small mt-8" style={{ marginBottom: 0 }}>Checked by {e.verification.by} on {fmtDateTime(e.verification.at)}{e.verification.note ? `: ${e.verification.note}` : ''}</p>
      </section>
      <section className="card card-pad mt-24" aria-labelledby="ev-h"><h2 id="ev-h" className="label mb-8">Events</h2>
        <div className="table-wrap"><table className="t"><caption className="sr-only">Agreement events</caption>
          <thead><tr><th scope="col">When (UTC)</th><th scope="col">Event</th><th scope="col">Who</th><th scope="col">Source</th></tr></thead>
          <tbody>{e.events.length ? e.events.map((v, i) => (
            <tr key={i}><td className="nowrap">{fmtUtc(v.at)}</td><td>{v.type}{v.detail ? <div className="small muted">{v.detail}</div> : null}</td><td>{v.user?.name ?? '—'}</td><td className="small">{SOURCE[v.source] ?? v.source}</td></tr>
          )) : <tr><td colSpan={4}><div className="empty">No events yet.</div></td></tr>}</tbody></table></div>
      </section>
      {open && canAct ? (
        <section className="card card-pad mt-24" aria-labelledby="cancel-h"><h2 id="cancel-h" className="label mb-8">Cancel this agreement</h2>
          <p className="small muted">Cancelling stops signing and returns the record to its owner. Sending a corrected agreement uses a new transaction.</p>
          <form action={cancelFromDetails.bind(null, e.id)} className="stack">
            <div className="field"><label htmlFor="cancel-reason">Reason (logged)</label><textarea className="textarea" id="cancel-reason" name="reason" required /></div>
            <button className="btn btn-danger" type="submit">Cancel agreement</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
