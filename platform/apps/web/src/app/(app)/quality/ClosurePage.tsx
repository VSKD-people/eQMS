import { load, loadOrNull } from '@/lib/page';
import type { ApprovalPlan, UserRow } from '@/lib/types';
import { Notice } from '@/components/ui';
import { SendForm } from '@/components/SendForm';
import { recordEffectiveness, sendClosure, writeJustification } from './actions';

// CAPA closure and deviation closure share one page: write the closure text, then verify and send one envelope.
export async function ClosurePage({ kind, number, sp }: { kind: 'capas' | 'quality-events'; number: string; sp: { a0?: string; ok?: string; err?: string } }) {
  const page = kind === 'capas' ? `/quality/capas/${number}` : `/quality/events/${number}`;
  const plan = await load<ApprovalPlan>(`/${kind}/${encodeURIComponent(number)}/approval-plan${sp.a0 ? `?approver=${encodeURIComponent(sp.a0)}` : ''}`);
  const users = await loadOrNull<UserRow[]>('/users');
  const candidates = (users ?? []).filter((u) => u.status === 'active' && (u.roles.includes('qm') || u.roles.includes('approver')));
  const approverId = sp.a0 ?? plan.signers.find((s) => s.meaning === 'Approved')?.userId ?? '';
  const needsText = plan.problems.some((p) => /Record the effectiveness result first|Write the closure justification first/.test(p));
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/quality">Quality</a><span>/</span><span>{number}</span></nav>
      <h1 className="mb-16">{kind === 'capas' ? `Close ${number}: effectiveness check` : `Close ${number} without a CAPA`}</h1>
      <Notice ok={sp.ok} err={sp.err} />
      <div className="callout mb-16"><strong>{kind === 'capas' ? 'CAPA closure is approved in DocuSign (Part 11)' : 'Deviations close through DocuSign (Part 11)'}</strong>
        <p className="small" style={{ margin: '4px 0 0' }}>One envelope: the owner signs first, then the QA approver. The record closes when the envelope completes.</p></div>
      {needsText ? (kind === 'capas' ? (
        <form action={recordEffectiveness.bind(null, number)} className="card card-pad">
          <div className="field mb-16"><label htmlFor="res">Result</label><textarea className="textarea" id="res" name="result" required placeholder="What the evidence shows" /></div>
          <fieldset className="mb-16"><legend>Verdict</legend>
            <label className="check"><input type="radio" name="verdict" value="Effective" defaultChecked /> Effective: close the CAPA</label>
            <label className="check"><input type="radio" name="verdict" value="Not effective" /> Not effective: back to execution for more actions</label></fieldset>
          <button className="btn btn-primary" type="submit">Save result</button>
        </form>) : (
        <form action={writeJustification.bind(null, number)} className="card card-pad">
          <div className="field mb-16"><label htmlFor="jus">Justification (required)</label><textarea className="textarea" id="jus" name="justification" required placeholder="Why no corrective or preventive action is needed" /></div>
          <button className="btn btn-primary" type="submit">Save justification</button>
        </form>)) : (
        <SendForm plan={plan} pdfHref={`/files/${kind}/${number}/pdf`} replanAction={page} approverCount={1} chosen={[approverId]} candidates={candidates}
          labels={{ footer: `The closure PDF footer shows ${number} and “Page X of Y”`, version: 'The closure summary matches the record (result, verdict or justification)', documentId: `The record ID ${number} and its title are correct`, dates: 'Dates are correct: raised, due and effectiveness dates' }}
          action={sendClosure.bind(null, kind, number, approverId)} />)}
    </>
  );
}
