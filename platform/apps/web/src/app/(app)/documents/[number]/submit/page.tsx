import { load, loadOrNull } from '@/lib/page';
import type { ApprovalPlan, DocumentDetail, UserRow } from '@/lib/types';
import { Notice } from '@/components/ui';
import { SignerList } from '@/components/agreement';
import { preparePdf, submitForReview } from '../../actions';

export const metadata = { title: 'Submit for review' };

// Submit in two steps: (1) choose reviewers and QA approvers, and the draft is converted to PDF, hashed and locked;
// (2) open the locked PDF, make the four checks, submit. What is checked is what is reviewed, approved and signed.
export default async function SubmitPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { number } = await params;
  const sp = await searchParams;
  const [d, users] = await Promise.all([load<DocumentDetail>(`/documents/${encodeURIComponent(number)}`), loadOrNull<UserRow[]>('/users')]);
  const plan = d.current.pdf ? await loadOrNull<ApprovalPlan>(`/documents/${encodeURIComponent(number)}/approval-plan`) : null;
  const active = (users ?? []).filter((u) => u.status === 'active' && u.id !== d.author.id && !u.roles.includes('auditor'));
  const reviewers = active.filter((u) => u.roles.includes('reviewer') || u.roles.includes('author'));
  const approvers = active.filter((u) => u.roles.includes('approver') || u.roles.includes('qm'));
  const cur = (pos: 1 | 2) => d.approvers.find((a) => a.position === pos)?.user.id ?? '';
  const pdf = d.current.pdf;
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/documents">Documents</a><span>/</span><a href={`/documents/${d.number}`}>{d.number}</a><span>/</span><span>Submit</span></nav>
      <h1 className="mb-16">Submit {d.number} v{d.current.version} for review</h1>
      <Notice ok={sp.ok} err={sp.err} />
      {!d.can.submit ? <div className="callout warn mb-16">Only the author or owner can submit a draft.</div> : null}
      {!users ? <div className="callout warn mb-16">The people list isn’t available to your role. Ask the Quality Manager to submit this document, or to give you access.</div> : null}

      <form action={preparePdf.bind(null, d.number)} className="card card-pad mb-16">
        <div className="label mb-8">Step 1 · Choose the people and make the PDF</div>
        <div className="statement mb-16"><div className="small muted">Change summary{d.current.changeRequest ? ` · ${d.current.changeRequest.number}` : ''}</div><div>{d.current.summary || '—'}</div></div>
        <fieldset className="mb-16"><legend>Reviewers (review in parallel; they sign after you)</legend>
          {reviewers.map((u) => <label className="check" key={u.id}><input type="checkbox" name="reviewers" value={u.id} defaultChecked={d.reviewers.some((r) => r.user.id === u.id)} /> {u.name} <span className="muted small">· {u.jobTitle ?? ''}</span></label>)}
        </fieldset>
        <div className="form-grid mb-16">
          <div className="field"><label htmlFor="a1">QA approver</label><select className="select" id="a1" name="a1" defaultValue={cur(1)} required><option value="">Choose…</option>{approvers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <div className="field"><label htmlFor="a2">Second QA approver (optional)</label><select className="select" id="a2" name="a2" defaultValue={cur(2)}><option value="">None</option>{approvers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        </div>
        <p className="small muted">The draft is converted to PDF with a signature field for each signer, hashed (SHA-256) and locked. Editing the draft afterwards clears it, and the PDF is made again.</p>
        <button className={`btn ${pdf ? '' : 'btn-primary'}`} type="submit" disabled={!d.can.submit}>{pdf ? 'Make the PDF again' : 'Make the PDF'}</button>
      </form>

      {pdf ? (
        <div className="stack">
          {plan ? <div className="card card-pad"><div className="label mb-8">Signing order in Adobe Sign (after approval)</div><SignerList signers={plan.signers} />
            {plan.problems.length ? <div className="callout warn mt-8" role="alert"><strong>Fix before submitting</strong>{plan.problems.map((p) => <p className="small" style={{ margin: '4px 0 0' }} key={p}>{p}</p>)}</div> : null}</div> : null}
          <form action={submitForReview.bind(null, d.number, pdf.sha256)} className="card card-pad">
            <div className="label mb-8">Step 2 · Check the locked PDF</div>
            <div className="statement mb-16"><div className="small muted">Locked PDF · SHA-256 <span className="mono">{pdf.sha256.slice(0, 16)}…</span></div>
              <div className="row-wrap mt-8"><a className="btn btn-sm" href={`/files/documents/${d.number}/pdf`}>Open the PDF to check it</a></div></div>
            <fieldset className="mb-16"><legend>Checks (all four required)</legend>
              <label className="check"><input type="checkbox" name="footer" required /> The footer shows {d.number}, version {d.current.version} and “Page X of Y” on every page</label>
              <label className="check"><input type="checkbox" name="version" required /> The version on the cover is v{d.current.version}</label>
              <label className="check"><input type="checkbox" name="documentId" required /> The document ID {d.number} is correct throughout, including the title block</label>
              <label className="check"><input type="checkbox" name="dates" required /> Dates are correct: issue date, review date and any dates in the text</label>
            </fieldset>
            <div className="field mb-16"><label htmlFor="note">Note for the record (optional)</label><input className="input" id="note" name="note" /></div>
            <div className="callout mb-16"><strong>What happens next</strong><p className="small" style={{ margin: '4px 0 0' }}>Reviewers mark it reviewed, then the QA approvers approve it here and decide whether people need retraining. Anyone on it can return it to you with a reason. When the last QA approver approves, this PDF goes to Adobe Sign in one agreement: you sign first as author, then the reviewers, then the QA approvers. It becomes effective when the agreement completes.</p></div>
            <button className="btn btn-primary" type="submit" disabled={!d.can.submit || !!plan?.problems.length}>Submit for review</button>
          </form>
        </div>
      ) : null}
      <div className="btn-row mt-16"><a className="btn" href={`/documents/${d.number}`}>Back to {d.number}</a></div>
    </>
  );
}
