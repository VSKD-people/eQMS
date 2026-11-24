import { getMe, load, loadOrNull } from '@/lib/page';
import type { ApprovalPlan, ClosureRecord, UserRow } from '@/lib/types';
import { fmtUtc } from '@/lib/format';
import { Chip, Notice } from '@/components/ui';
import { SendForm } from '@/components/SendForm';
import { AgreementCard, AgreementFiles } from '@/components/agreement';
import { MockSignPanel } from '@/components/MockSign';
import { recordEffectiveness, sendClosure, writeJustification } from './actions';

// CAPA closure and deviation closure share one page: write the closure text, verify and send one agreement, then
// follow it until it completes. While the agreement is out, the signer whose turn it is can sign here in mock mode.
export async function ClosurePage({ kind, number, sp }: { kind: 'capas' | 'quality-events'; number: string; sp: { a0?: string; ok?: string; err?: string } }) {
  const page = kind === 'capas' ? `/quality/capas/${number}` : `/quality/events/${number}`;
  const [rec, me] = await Promise.all([load<ClosureRecord>(`/${kind}/${encodeURIComponent(number)}`), getMe()]);
  const env = rec.agreement;
  const out = env?.status === 'sent' ? env : null;
  const closed = rec.state === 'Closed';
  // Only deviations close here without a CAPA; other quality events close when their CAPA closes.
  const notHere = kind === 'quality-events' && rec.type !== 'Deviation';
  const canSend = !closed && !out && !notHere;

  const header = (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/quality">Quality</a><span>/</span><span>{number}</span></nav>
      <div className="page-head"><div>
        <div className="record-meta"><span>{kind === 'capas' ? 'CAPA' : rec.type} · {number}</span><Chip text={rec.state} cls={closed ? 'chip-done' : 'chip-outline'} /></div>
        <h1>{rec.title}</h1>
        <div className="sub">Owner: {rec.owner.name}{rec.closedAt ? ` · closed ${fmtUtc(rec.closedAt)}` : ''}</div>
      </div></div>
      <Notice ok={sp.ok} err={sp.err} />
    </>
  );

  if (!canSend) {
    return (
      <>
        {header}
        {out ? <MockSignPanel e={out} me={me} back={page} /> : null}
        {closed ? <div className="callout ok mb-16" role="status"><strong>Closed.</strong> {env?.status === 'completed' ? 'The closure was approved through Adobe Sign; the signed PDF and certificate are stored with the agreement.' : ''}</div> : null}
        {notHere && !closed ? <div className="callout mb-16"><strong>This {rec.type?.toLowerCase()} closes when its CAPA closes.</strong> Only deviations without a CAPA are closed here.</div> : null}
        {env ? <AgreementCard e={env}>{env.status === 'completed' ? <AgreementFiles e={env} /> : null}</AgreementCard> : null}
      </>
    );
  }

  const plan = await load<ApprovalPlan>(`/${kind}/${encodeURIComponent(number)}/approval-plan${sp.a0 ? `?approver=${encodeURIComponent(sp.a0)}` : ''}`);
  const users = await loadOrNull<UserRow[]>('/users');
  const candidates = (users ?? []).filter((u) => u.status === 'active' && (u.roles.includes('qm') || u.roles.includes('approver')));
  const approverId = sp.a0 ?? plan.signers.find((s) => s.meaning === 'Approved')?.userId ?? '';
  const needsText = plan.problems.some((p) => /Record the effectiveness result first|Write the closure justification first/.test(p));
  return (
    <>
      {header}
      <div className="callout mb-16"><strong>{kind === 'capas' ? 'CAPA closure is approved in Adobe Sign (Part 11)' : 'Deviations close through Adobe Sign (Part 11)'}</strong>
        <p className="small" style={{ margin: '4px 0 0' }}>One agreement: the owner signs first, then the QA approver. The record closes when the agreement completes.</p></div>
      {/* After a decline or cancellation, show what happened so the owner can fix it before sending again. */}
      {env && (env.status === 'declined' || env.status === 'cancelled') ? <div className="mb-16"><AgreementCard e={env} /></div> : null}
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
