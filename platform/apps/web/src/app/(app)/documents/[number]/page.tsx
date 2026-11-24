import { getMe, load, loadOrNull } from '@/lib/page';
import type { DocumentDetail, AgreementSummary, Group, TrainingRecord, UserRow } from '@/lib/types';
import { fmtDate, fmtDateTime, fmtUtc } from '@/lib/format';
import { Chip, Cls, Notice, Stepper, Tabs } from '@/components/ui';
import { AgreementCard, AgreementFiles, AgreementStatus } from '@/components/agreement';
import { MockSignPanel } from '@/components/MockSign';
import { AudienceFields } from '../AudienceFields';
import { changeAudience, markReviewed, newVersion, sendBack, cancelAgreement } from '../actions';

const STATES = ['Draft', 'In review', 'Review closed', 'In approval', 'Effective'];

type Props = { params: Promise<{ number: string }>; searchParams: Promise<{ tab?: string; all?: string; ok?: string; err?: string }> };

export async function generateMetadata({ params }: Props) { return { title: (await params).number }; }

export default async function DocumentPage({ params, searchParams }: Props) {
  const { number } = await params;
  const sp = await searchParams;
  const tab = ['document', 'history', 'approval', 'training'].includes(sp.tab ?? '') ? (sp.tab as string) : 'document';
  const [d, me] = await Promise.all([load<DocumentDetail>(`/documents/${encodeURIComponent(number)}`), getMe()]);
  const env = d.agreement;
  const labels: Record<string, string> = { 'Review closed': 'Review closed · verify and send', 'In approval': env && env.status === 'sent' ? `Adobe Sign · ${env.signed} of ${env.signers.length} signed` : 'In approval' };

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/documents">Documents</a><span>/</span><span>{d.number}</span></nav>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="record-meta"><span>{d.docType} · {d.number}</span><Cls c={d.classification} /><span className="chip chip-outline">v{d.current.version} · {d.current.state}</span></div>
          <h1>{d.title}</h1>
        </div>
        <div className="btn-row">
          {d.can.edit ? <a className="btn" href={`/documents/${d.number}/edit`}>Edit draft</a> : null}
          {d.can.submit ? <a className="btn btn-primary" href={`/documents/${d.number}/submit`}>Submit for review</a> : null}
          {d.can.send ? <a className="btn btn-primary" href={`/documents/${d.number}/send`}>Verify and send to Adobe Sign</a> : null}
          <a className="btn" href={`/files/documents/${d.number}/pdf`}>PDF</a>
        </div>
      </div>
      <Notice ok={sp.ok} err={sp.err} />
      {d.can.sign && env ? (me.esignMode === 'mock'
        ? <MockSignPanel e={env} me={me} back={`/documents/${encodeURIComponent(d.number)}?tab=approval`} />
        : <div className="callout mb-16"><strong>Your turn to sign in Adobe Sign.</strong> Use the link in your Adobe Sign email. Adobe Sign asks you to sign in again and records the meaning with your signature.</div>) : null}
      {d.state !== 'Obsolete' ? <div className="card mb-16"><Stepper states={STATES} current={d.state === 'Superseded' ? 'Effective' : d.state} labels={labels} /></div>
        : <div className="callout warn mb-16"><strong>Obsolete.</strong> Archived, not deleted; it stays in the register and audit trail.</div>}

      {(d.can.review || d.can.sendBack || d.can.newVersion) ? (
        <div className="card card-pad mb-16"><div className="label mb-8">Actions</div><div className="stack-sm">
          {d.can.review ? (
            <details><summary className="btn-link" style={{ padding: 0 }}>Mark reviewed</summary>
              <form action={markReviewed.bind(null, d.number)} className="mt-8">
                <div className="field"><label htmlFor="rc">Comment (optional)</label><textarea className="textarea" id="rc" name="comment" /></div>
                <button className="btn btn-primary mt-8" type="submit">Mark reviewed</button>
                <p className="small muted mt-8">When you’re the last reviewer, review closes and the owner is asked to verify and send the Adobe Sign agreement.</p>
              </form></details>) : null}
          {d.can.sendBack ? (
            <details><summary className="btn-link" style={{ padding: 0 }}>Send back to draft</summary>
              <form action={sendBack.bind(null, d.number)} className="mt-8">
                <div className="field"><label htmlFor="sb">Reason (required)</label><textarea className="textarea" id="sb" name="reason" required /></div>
                <button className="btn mt-8" type="submit">Send back</button>
              </form></details>) : null}
          {d.can.newVersion ? (
            <details><summary className="btn-link" style={{ padding: 0 }}>Start a new version</summary>
              <form action={newVersion.bind(null, d.number)} className="mt-8">
                <fieldset className="mb-8"><legend>Kind of change</legend>
                  <label className="check"><input type="radio" name="kind" value="major" defaultChecked /> Major: changes what people must do</label>
                  <label className="check"><input type="radio" name="kind" value="minor" /> Minor: wording, layout or corrections</label></fieldset>
                <div className="field"><label htmlFor="nv">Why is it changing? (required)</label><textarea className="textarea" id="nv" name="summary" required /></div>
                <button className="btn mt-8" type="submit">Start draft</button>
                <p className="small muted mt-8">v{d.current.version} stays effective until the new version’s Adobe Sign agreement completes.</p>
              </form></details>) : null}
        </div></div>) : null}

      <div className="split">
        <div style={{ minWidth: 0 }}>
          <Tabs base={`/documents/${d.number}`} current={tab} tabs={[['document', 'Document'], ['history', 'Version history'], ['approval', 'Approval · Adobe Sign'], ['training', 'Training']]} />
          {tab === 'document' ? <DocumentBody d={d} /> : null}
          {tab === 'history' ? <History d={d} /> : null}
          {tab === 'approval' ? <Approval d={d} /> : null}
          {tab === 'training' ? <Training d={d} all={sp.all === '1'} /> : null}
        </div>
        <aside className="context" aria-label="Record details">
          <div className="card ctx-card"><span className="label">Details</span><dl className="dl">
            <div><dt>Owner</dt><dd>{d.owner.name}</dd></div><div><dt>Author</dt><dd>{d.author.name}</dd></div>
            <div><dt>Quality process</dt><dd>{d.process}</dd></div><div><dt>Effective</dt><dd>{fmtDate(d.effectiveAt)}</dd></div>
            {d.approvalDue && d.state === 'In approval' ? <div><dt>Approval due</dt><dd>{fmtDate(d.approvalDue)}</dd></div> : null}
            <div><dt>Tags</dt><dd>{d.tags.join(', ') || '—'}</dd></div>
          </dl></div>
          <div className="card ctx-card"><span className="label">People</span>
            {d.reviewers.map((r) => <div className="people-row" key={r.user.id}><span className="who"><span>{r.user.name} · Reviewer</span></span><span className="status-text">{r.status}</span></div>)}
            {d.approvers.map((a) => <div className="people-row" key={a.user.id}><span className="who"><span>{a.user.name} · QA approver {d.approvers.length > 1 ? a.position : ''}</span></span><span className="status-text">{a.status}</span></div>)}
            <p className="small muted mt-8" style={{ marginBottom: 0 }}>Adobe Sign signing order: author, reviewers, then QA approver.</p>
          </div>
          {env ? <AgreementCard e={env} /> : null}
        </aside>
      </div>
    </>
  );
}

function DocumentBody({ d }: { d: DocumentDetail }) {
  return (
    <div className="viewer" tabIndex={0} aria-label="Document"><div className="page" style={{ minHeight: 0 }}>
      <h2>{d.number} {d.title}</h2>
      <div className="doc-meta"><span>Version {d.current.version} · {d.current.state}</span><span>Owner: {d.owner.name}</span><span>{d.classification.toUpperCase()}</span></div>
      {d.current.content.map((b, i) => (b.t === 'h' ? <h3 key={i}>{b.x}</h3> : <p key={i}>{b.x}</p>))}
      <p className="small muted mt-16">Change summary: {d.current.summary || '—'} · SHA-256 <span className="mono">{d.current.contentSha256.slice(0, 16)}…</span></p>
    </div></div>
  );
}

function History({ d }: { d: DocumentDetail }) {
  return (
    <div className="table-wrap"><table className="t"><caption className="sr-only">Version history</caption>
      <thead><tr><th scope="col">Version</th><th scope="col">State</th><th scope="col">Change summary</th><th scope="col">Approved</th><th scope="col">Approval record</th></tr></thead>
      <tbody>{d.versions.slice().reverse().map((v) => (
        <tr key={v.id}><td><b>v{v.version}</b> <span className="small muted">{v.kind}</span></td><td><Chip text={v.state} /></td><td className="small">{v.summary}</td><td>{fmtDate(v.approvedAt)}</td>
          <td>{v.agreementId ? <a href={`/approvals/${v.agreementId}`}>Adobe Sign agreement</a> : v.migratedFrom ? <span className="small muted">{v.migratedFrom} (migrated)</span> : '—'}</td></tr>
      ))}</tbody></table></div>
  );
}

async function Approval({ d }: { d: DocumentDetail }) {
  const list = await load<{ items: AgreementSummary[] }>(`/agreements?record=${encodeURIComponent(d.number)}`).catch(() => ({ items: d.agreement ? [d.agreement] : [] }));
  const items = list.items.filter((e) => e.recordNumber === d.number);
  if (!items.length) return <div className="empty"><h3>No Adobe Sign agreements yet</h3><p>{d.state === 'Review closed' ? 'Verify the PDF and send it to Adobe Sign.' : 'An agreement is sent once review closes.'}</p></div>;
  return (
    <div className="stack">
      {items.map((e) => (
        <div className="card card-pad" key={e.id}>
          <div className="spread"><div><b>v{e.version}</b> · sent {fmtDateTime(e.sentAt)} by {e.sentBy.name} {e.correctionOf ? <Chip text="Correction" cls="chip-due" /> : null}</div><AgreementStatus e={e} /></div>
          <p className="small muted">Transaction {e.transactionNo} of the {e.allowanceYear} allowance · {e.signed} of {e.signers.length} signed{e.completedAt ? ` · completed ${fmtUtc(e.completedAt)}` : ''}</p>
          {e.reason ? <p className="small"><b>{e.status === 'declined' ? 'Declined' : 'Cancelled'}:</b> {e.reason}</p> : null}
          <div className="row-wrap"><AgreementFiles e={e} /><a className="btn btn-sm" href={`/approvals/${e.id}`}>Details</a></div>
          {e.status === 'sent' && d.can.cancel ? (
            <details className="mt-16"><summary className="btn-link" style={{ padding: 0 }}>Cancel this agreement</summary>
              <form action={cancelAgreement.bind(null, d.number, e.id)} className="mt-8">
                <div className="callout warn mb-8"><strong>Cancelling stops the agreement for every signer.</strong> The document goes back to draft with your reason recorded. A corrected agreement uses a new transaction.</div>
                <div className="field"><label htmlFor={`vr-${e.id}`}>Reason (required)</label><textarea className="textarea" id={`vr-${e.id}`} name="reason" required /></div>
                <button className="btn btn-danger mt-8" type="submit">Cancel agreement</button>
              </form></details>) : null}
        </div>
      ))}
    </div>
  );
}

async function Training({ d, all }: { d: DocumentDetail; all: boolean }) {
  // The API shows other people's training records only to the document owner and to people with organisation-wide
  // training access; anyone else gets 403, so load with loadOrNull and say so instead of failing the page.
  const [records, groups, users] = await Promise.all([
    loadOrNull<TrainingRecord[]>(`/documents/${d.number}/training${all ? '?all=1' : ''}`),
    d.can.changeAudience ? load<Group[]>('/groups') : Promise.resolve([] as Group[]),
    d.can.changeAudience ? loadOrNull<UserRow[]>('/users') : Promise.resolve(null)
  ]);
  const a = d.audience;
  const who = [...a.groups, ...a.roles.map((r) => `role: ${r}`), ...a.users.map((u) => u.name)].join(', ') || 'Nobody (no training needed)';
  return (
    <>
      <div className="card card-pad mb-16"><div className="label mb-8">Who must train</div><p style={{ margin: 0 }}>{who} · {a.daysToComplete} days to complete{a.quiz ? ' · knowledge check' : ''}</p>
        {d.can.changeAudience ? (
          <details className="mt-16"><summary className="btn-link" style={{ padding: 0 }}>Change audience</summary>
            <form action={changeAudience.bind(null, d.number)} className="mt-8">
              <AudienceFields groups={groups} users={users} value={a} />
              <button className="btn btn-primary mt-16" type="submit">Save audience</button>
              <p className="small muted mt-8">New members are allocated the effective version now; open allocations for people no longer in the audience close. The change is logged with the old and new audience.</p>
            </form></details>) : null}
      </div>
      {records === null ? (
        <div className="callout"><strong>Training records for this document are visible to its owner and to training managers.</strong> Your own training is under <a href="/training">Training</a>.</div>
      ) : (<>
      <div className="spread mb-8"><a className="small" href={`/documents/${d.number}?tab=training${all ? '' : '&all=1'}`}>{all ? 'Show the effective version only' : 'Show earlier versions, withdrawn and corrected records'}</a>
        <div className="btn-row"><a className="btn btn-sm" href={`/reports/document-status.pdf?documentNumber=${d.number}`}>Export PDF</a><a className="btn btn-sm" href={`/reports/document-status.xlsx?documentNumber=${d.number}`}>Export Excel</a></div></div>
      <div className="table-wrap"><table className="t"><caption className="sr-only">Training records</caption>
        <thead><tr><th scope="col">Person</th><th scope="col">Version</th><th scope="col">Allocated</th><th scope="col">Due</th><th scope="col">Completed (UTC)</th><th scope="col">Status</th></tr></thead>
        <tbody>{records.length ? records.map((r) => (
          <tr key={r.id}><td><a href={`/training/records/${r.id}`}>{r.user.name}</a></td><td>v{r.version}</td><td className="small">{r.allocReason} · {r.allocatedBy?.name ?? 'System'}</td>
            <td>{fmtDate(r.dueAt)}</td><td>{r.completedAt ? fmtUtc(r.completedAt) : '—'}</td><td><Chip text={r.status} /></td></tr>
        )) : <tr><td colSpan={6}><div className="empty">No training allocated for this version.</div></td></tr>}</tbody></table></div>
      </>)}
    </>
  );
}
