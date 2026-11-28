import type { AgreementSummary, Signer } from '@/lib/types';
import { AGREEMENT_STATUS, SIGNER_STATUS, fmtDateTime, fmtShort } from '@/lib/format';
import { Chip } from './ui';

export function SignerList({ signers }: { signers: Signer[] }) {
  return (
    <ol className="list-rows" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {signers.slice().sort((a, b) => a.routingOrder - b.routingOrder).map((s) => (
        <li className="list-row" key={s.userId + s.routingOrder}>
          <span className="chip chip-outline" aria-label={`Signing order ${s.routingOrder}`}>{s.routingOrder}</span>
          <div className="lr-main"><b>{s.name}</b> · {s.roleLabel}<div className="small muted">Signature meaning: {s.meaning}</div></div>
          <Chip text={SIGNER_STATUS[s.status] ?? s.status} cls={s.status === 'signed' ? 'chip-done' : s.status === 'declined' ? 'chip-overdue' : s.status === 'sent' ? 'chip-turn' : 'chip-outline'} />
          {s.signedAt ? <span className="small muted">{fmtShort(s.signedAt)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

export function AgreementStatus({ e }: { e: AgreementSummary }) {
  return <Chip text={AGREEMENT_STATUS[e.status] ?? e.status} cls={e.status === 'completed' ? 'chip-done' : e.status === 'sent' ? 'chip-turn' : e.status === 'declined' ? 'chip-overdue' : 'chip-outline'} />;
}

export function AgreementCard({ e, children }: { e: AgreementSummary; children?: React.ReactNode }) {
  return (
    <div className="card ctx-card">
      <div className="spread"><span className="label" style={{ margin: 0 }}>{e.provider === 'simulated' ? 'Simulated approval' : 'Adobe Sign approval'}</span><AgreementStatus e={e} /></div>
      {e.provider === 'simulated' ? <Chip text="Simulated · not Part 11" cls="chip-due" /> : null}
      <div className="small mt-8" style={{ fontWeight: 600 }}>{e.subject}</div>
      <div className="small muted">Transaction {e.transactionNo} of the {e.allowanceYear} allowance · sent {fmtDateTime(e.sentAt)} by {e.sentBy.name}</div>
      {e.status === 'sent' ? <p className="small mt-8" style={{ marginBottom: 0 }}>{e.provider === 'simulated' ? 'Signers sign on the record page, in order (Adobe Sign isn’t connected).' : 'Signers sign from the Adobe Sign email, in order.'} {e.signed} of {e.signers.length} signed.</p> : null}
      {e.reason ? <p className="small mt-8" style={{ marginBottom: 0 }}><b>{e.status === 'declined' ? 'Declined' : 'Cancelled'}:</b> {e.reason}</p> : null}
      <div className="mt-8"><SignerList signers={e.signers} /></div>
      <div className="btn-row mt-16"><a className="btn btn-sm" href={`/approvals/${e.id}`}>Agreement details</a>{children}</div>
    </div>
  );
}

// The PDFs stored with an agreement, served through the web app's file proxy.
export function AgreementFiles({ e }: { e: AgreementSummary }) {
  return (
    <span className="row-wrap">
      <a className="btn btn-sm" href={`/files/agreements/${e.id}/original`}>Sent PDF</a>
      {e.status === 'completed' ? <><a className="btn btn-sm" href={`/files/agreements/${e.id}/signed`}>Signed PDF</a><a className="btn btn-sm" href={`/files/agreements/${e.id}/audit-report`}>Audit report</a></> : null}
    </span>
  );
}
