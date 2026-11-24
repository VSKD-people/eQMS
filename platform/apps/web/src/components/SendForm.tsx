import type { ApprovalPlan, UserRow } from '@/lib/types';
import { SignerList } from './envelope';

// Shared by documents, CAPA closure and deviation closure: plan, verification check, then one DocuSign send.
// Changing the QA approver re-plans with a plain GET form (works without JavaScript).
export function SendForm({ plan, pdfHref, replanAction, approverCount, chosen, candidates, labels, action, disabled }: {
  plan: ApprovalPlan; pdfHref: string; replanAction: string; approverCount: 1 | 2; chosen: string[]; candidates: UserRow[];
  labels: { footer: string; version: string; documentId: string; dates: string };
  action: (fd: FormData) => Promise<void>; disabled?: boolean;
}) {
  const blocked = disabled || plan.problems.length > 0 || plan.allowance.exhausted;
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="statement mb-16"><div className="small muted">Envelope subject</div><div style={{ fontWeight: 600 }}>{plan.subject}</div>
          <div className="row-wrap mt-8"><a className="btn btn-sm" href={pdfHref}>Open the PDF to check it</a></div></div>
        <form method="get" action={replanAction} className="form-grid">
          {Array.from({ length: approverCount }, (_, i) => (
            <div className="field" key={i}><label htmlFor={`ap${i}`}>{i === 0 ? 'QA approver' : 'Second QA approver (optional)'}</label>
              <select className="select" id={`ap${i}`} name={`a${i}`} defaultValue={chosen[i] ?? ''}>{i > 0 ? <option value="">None</option> : null}
                {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}{u.roles.includes('qm') ? ' · Quality Manager' : ' · Approver'}</option>)}</select></div>
          ))}
          <div className="full"><button className="btn btn-sm" type="submit" formAction={replanAction}>Update signing order</button></div>
        </form>
      </div>
      <div className="card card-pad"><div className="label mb-8">Signing order in DocuSign</div><SignerList signers={plan.signers} /></div>
      {plan.problems.length ? <div className="callout warn" role="alert"><strong>Fix before sending</strong>{plan.problems.map((p) => <p className="small" style={{ margin: '4px 0 0' }} key={p}>{p}</p>)}</div> : null}
      <form action={action} className="card card-pad">
        <fieldset className="mb-16"><legend>Verification check (required before sending)</legend>
          <label className="check"><input type="checkbox" name="footer" required /> {labels.footer}</label>
          <label className="check"><input type="checkbox" name="version" required /> {labels.version}</label>
          <label className="check"><input type="checkbox" name="documentId" required /> {labels.documentId}</label>
          <label className="check"><input type="checkbox" name="dates" required /> {labels.dates}</label>
          <div className="help">A correction after sending means voiding the envelope and sending again, which costs a second send.</div>
        </fieldset>
        <div className="field mb-16"><label htmlFor="note">Note for the record (optional)</label><input className="input" id="note" name="note" /></div>
        <div className={`callout ${plan.allowance.low ? 'warn' : ''} mb-16`}><strong>This uses 1 DocuSign send</strong>
          <p className="small" style={{ margin: '4px 0 0' }}>It uses 1 of {plan.allowance.remaining} sends left this year ({plan.allowance.used} of {plan.allowance.allowance} used). Every signer is in this one envelope.</p></div>
        <button className="btn btn-primary" type="submit" disabled={blocked}>Send to DocuSign</button>
        {blocked && !disabled ? <p className="small muted mt-8">{plan.allowance.exhausted ? 'This year’s allowance is used up.' : 'Fix the problems above first.'}</p> : null}
      </form>
    </div>
  );
}
