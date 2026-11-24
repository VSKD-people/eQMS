import { load, loadOrNull } from '@/lib/page';
import type { DocumentDetail, UserRow } from '@/lib/types';
import { Notice } from '@/components/ui';
import { submitForReview } from '../../actions';

export const metadata = { title: 'Submit for review' };

export default async function SubmitPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ err?: string }> }) {
  const { number } = await params;
  const sp = await searchParams;
  const [d, users] = await Promise.all([load<DocumentDetail>(`/documents/${encodeURIComponent(number)}`), loadOrNull<UserRow[]>('/users')]);
  const active = (users ?? []).filter((u) => u.status === 'active' && u.id !== d.author.id && !u.roles.includes('auditor'));
  const reviewers = active.filter((u) => u.roles.includes('reviewer') || u.roles.includes('author'));
  const approvers = active.filter((u) => u.roles.includes('approver') || u.roles.includes('qm'));
  const cur = (pos: 1 | 2) => d.approvers.find((a) => a.position === pos)?.user.id ?? '';
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/documents">Documents</a><span>/</span><a href={`/documents/${d.number}`}>{d.number}</a><span>/</span><span>Submit</span></nav>
      <h1 className="mb-16">Submit {d.number} v{d.current.version} for review</h1>
      <Notice err={sp.err} />
      {!users ? <div className="callout warn mb-16">The people list isn’t available to your role. Ask the Quality Manager to submit this document, or to give you access.</div> : null}
      <form action={submitForReview.bind(null, d.number)} className="card card-pad">
        <div className="statement mb-16"><div className="small muted">Change summary</div><div>{d.current.summary || '—'}</div></div>
        <fieldset className="mb-16"><legend>Reviewers (review in parallel; they sign the envelope after you)</legend>
          {reviewers.map((u) => <label className="check" key={u.id}><input type="checkbox" name="reviewers" value={u.id} defaultChecked={d.reviewers.some((r) => r.user.id === u.id)} /> {u.name} <span className="muted small">· {u.jobTitle ?? ''}</span></label>)}
        </fieldset>
        <div className="form-grid mb-16">
          <div className="field"><label htmlFor="a1">QA approver</label><select className="select" id="a1" name="a1" defaultValue={cur(1)} required><option value="">Choose…</option>{approvers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <div className="field"><label htmlFor="a2">Second QA approver (optional)</label><select className="select" id="a2" name="a2" defaultValue={cur(2)}><option value="">None</option>{approvers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        </div>
        <div className="callout"><strong>What happens next</strong><p className="small" style={{ margin: '4px 0 0' }}>Reviewers comment and mark the document reviewed here. When review closes, the owner checks the PDF and sends one DocuSign envelope: you sign first as author, then the reviewers, then the QA approver. The document becomes effective when the envelope completes.</p></div>
        <div className="btn-row mt-16"><button className="btn btn-primary" type="submit">Submit for review</button><a className="btn" href={`/documents/${d.number}`}>Cancel</a></div>
      </form>
    </>
  );
}
