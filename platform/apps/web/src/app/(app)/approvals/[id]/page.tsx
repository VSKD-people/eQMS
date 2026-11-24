import { getMe, has, loadOrNull } from '@/lib/page';
import type { Envelope } from '@/lib/types';
import { ENVELOPE_STATUS, fmtDateTime, fmtUtc, recordHref } from '@/lib/format';
import { Notice } from '@/components/ui';
import { EnvelopeFiles, EnvelopeStatus, SignerList } from '@/components/envelope';
import { MockSignPanel } from '@/components/MockSign';
import { refreshStatus, voidFromDetails } from '../actions';

export const metadata = { title: 'Envelope details' };

const SOURCE: Record<string, string> = { app: 'VeQMS', connect: 'DocuSign Connect', poll: 'Status check' };

export default async function EnvelopePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await getMe();
  const e = await loadOrNull<Envelope>(`/envelopes/${encodeURIComponent(id)}`);
  if (!e) return <div className="card card-pad"><h1>Envelope not available</h1><p className="muted">It doesn’t exist, or you don’t have access to it.</p><a className="btn" href="/approvals">Back to Approvals</a></div>;
  const open = e.status === 'sent';
  const canAct = has(me, 'docusign.send');
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/approvals">Approvals and DocuSign</a><span>/</span><span>Send #{e.sendNo} · {e.allowanceYear}</span></nav>
      <div className="page-head">
        <div><h1>{e.subject}</h1>
          <div className="sub row-wrap"><EnvelopeStatus e={e} /> <a href={recordHref(e.recordType, e.recordNumber)}>{e.recordNumber}{e.version ? ` v${e.version}` : ''}</a> · {e.purpose}</div></div>
        <div className="btn-row">
          <EnvelopeFiles e={e} />
          {open && canAct ? <form action={refreshStatus.bind(null, e.id)}><button className="btn btn-sm" type="submit">Check status with DocuSign</button></form> : null}
        </div>
      </div>
      <Notice ok={sp.ok} err={sp.err} />
      <MockSignPanel e={e} me={me} back={`/approvals/${e.id}`} />
      {e.reason ? <div className="callout mb-16"><strong>{ENVELOPE_STATUS[e.status]}:</strong> {e.reason}</div> : null}
      <div className="grid-2">
        <section className="card card-pad" aria-labelledby="sig-h"><h2 id="sig-h" className="label mb-8">Signers, in order</h2>
          <SignerList signers={e.signers} />
          <p className="small muted mt-16">Signers sign from the DocuSign email. DocuSign asks each of them to sign in again and records the meaning with the signature. VeQMS shows status only; it never signs for anyone.</p>
        </section>
        <section className="card card-pad" aria-labelledby="env-h"><h2 id="env-h" className="label mb-8">Envelope</h2>
          <dl className="dl">
            <div><dt>DocuSign envelope ID</dt><dd><code>{e.docusignEnvelopeId ?? 'Not issued (migrated record)'}</code></dd></div>
            <div><dt>Send</dt><dd>#{e.sendNo} of the {e.allowanceYear} allowance</dd></div>
            <div><dt>Sent</dt><dd>{fmtDateTime(e.sentAt)} by {e.sentBy.name}</dd></div>
            <div><dt>Completed</dt><dd>{fmtDateTime(e.completedAt)}</dd></div>
            {e.correctionOf ? <div><dt>Corrects</dt><dd><a href={`/approvals/${e.correctionOf}`}>Earlier envelope</a></dd></div> : null}
            <div><dt>Sent PDF (SHA-256)</dt><dd><code className="small" style={{ wordBreak: 'break-all' }}>{e.files.original.sha256}</code></dd></div>
            {e.files.signed ? <div><dt>Signed PDF (SHA-256)</dt><dd><code className="small" style={{ wordBreak: 'break-all' }}>{e.files.signed.sha256}</code></dd></div> : null}
            {e.files.certificate ? <div><dt>Certificate (SHA-256)</dt><dd><code className="small" style={{ wordBreak: 'break-all' }}>{e.files.certificate.sha256}</code></dd></div> : null}
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
        <div className="table-wrap"><table className="t"><caption className="sr-only">Envelope events</caption>
          <thead><tr><th scope="col">When (UTC)</th><th scope="col">Event</th><th scope="col">Who</th><th scope="col">Source</th></tr></thead>
          <tbody>{e.events.length ? e.events.map((v, i) => (
            <tr key={i}><td className="nowrap">{fmtUtc(v.at)}</td><td>{v.type}{v.detail ? <div className="small muted">{v.detail}</div> : null}</td><td>{v.user?.name ?? '—'}</td><td className="small">{SOURCE[v.source] ?? v.source}</td></tr>
          )) : <tr><td colSpan={4}><div className="empty">No events yet.</div></td></tr>}</tbody></table></div>
      </section>
      {open && canAct ? (
        <section className="card card-pad mt-24" aria-labelledby="void-h"><h2 id="void-h" className="label mb-8">Void this envelope</h2>
          <p className="small muted">Voiding stops signing and returns the record to its owner. Sending a corrected envelope counts as a new send.</p>
          <form action={voidFromDetails.bind(null, e.id)} className="stack">
            <div className="field"><label htmlFor="void-reason">Reason (logged)</label><textarea className="textarea" id="void-reason" name="reason" required /></div>
            <button className="btn btn-danger" type="submit">Void envelope</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
