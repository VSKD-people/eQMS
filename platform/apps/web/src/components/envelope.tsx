import type { EnvelopeSummary, Signer } from '@/lib/types';
import { ENVELOPE_STATUS, SIGNER_STATUS, fmtDateTime, fmtShort } from '@/lib/format';
import { Chip } from './ui';

export function SignerList({ signers }: { signers: Signer[] }) {
  return (
    <ol className="list-rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {signers.slice().sort((a, b) => a.routingOrder - b.routingOrder).map((s) => (
        <li className="list-row" key={s.userId + s.routingOrder}>
          <span className="chip chip-outline" aria-label={`Signing order ${s.routingOrder}`}>{s.routingOrder}</span>
          <div className="lr-main"><b>{s.name}</b> · {s.roleLabel}<div className="small muted">Signature meaning: {s.meaning}</div></div>
          <Chip text={SIGNER_STATUS[s.status] ?? s.status} cls={s.status === 'signed' ? 'chip-done' : s.status === 'declined' ? 'chip-overdue' : s.status === 'sent' || s.status === 'delivered' ? 'chip-turn' : 'chip-outline'} />
          {s.signedAt ? <span className="small muted">{fmtShort(s.signedAt)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function EnvelopeStatus({ e }: { e: EnvelopeSummary }) {
  return <Chip text={ENVELOPE_STATUS[e.status] ?? e.status} cls={e.status === 'completed' ? 'chip-done' : e.status === 'sent' ? 'chip-turn' : e.status === 'declined' ? 'chip-overdue' : 'chip-outline'} />;
}

export function EnvelopeCard({ e, children }: { e: EnvelopeSummary; children?: React.ReactNode }) {
  return (
    <div className="card ctx-card">
      <div className="spread"><span className="label" style={{ margin: 0 }}>DocuSign approval</span><EnvelopeStatus e={e} /></div>
      <div className="small mt-8" style={{ fontWeight: 600 }}>{e.subject}</div>
      <div className="small muted">Send {e.sendNo} of the {e.allowanceYear} allowance · sent {fmtDateTime(e.sentAt)} by {e.sentBy.name}</div>
      {e.status === 'sent' ? <p className="small mt-8" style={{ marginBottom: 0 }}>Signers sign from the DocuSign email, in order. {e.signed} of {e.signers.length} signed.</p> : null}
      {e.reason ? <p className="small mt-8" style={{ marginBottom: 0 }}><b>{e.status === 'declined' ? 'Declined' : 'Voided'}:</b> {e.reason}</p> : null}
      <div className="mt-8"><SignerList signers={e.signers} /></div>
      <div className="btn-row mt-16"><a className="btn btn-sm" href={`/approvals/${e.id}`}>Envelope details</a>{children}</div>
    </div>
  );
}

// The PDFs stored with an envelope, served through the web app's file proxy.
export function EnvelopeFiles({ e }: { e: EnvelopeSummary }) {
  return (
    <span className="row-wrap">
      <a className="btn btn-sm" href={`/files/envelopes/${e.id}/original`}>Sent PDF</a>
      {e.status === 'completed' ? <><a className="btn btn-sm" href={`/files/envelopes/${e.id}/signed`}>Signed PDF</a><a className="btn btn-sm" href={`/files/envelopes/${e.id}/certificate`}>Certificate</a></> : null}
    </span>
  );
}
