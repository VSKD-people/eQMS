import { load, loadOrNull } from '@/lib/page';
import type { ApprovalPlan, DocumentDetail, UserRow } from '@/lib/types';
import { Notice } from '@/components/ui';
import { SendForm } from '@/components/SendForm';
import { sendAgreement } from '../../actions';

export const metadata = { title: 'Verify and send' };

export default async function SendPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ approvers?: string; a0?: string; a1?: string; err?: string }> }) {
  const { number } = await params;
  const sp = await searchParams;
  const d = await load<DocumentDetail>(`/documents/${encodeURIComponent(number)}`);
  const chosen = (sp.a0 !== undefined ? [sp.a0, sp.a1 ?? ''] : (sp.approvers ?? d.approvers.slice().sort((a, b) => a.position - b.position).map((a) => a.user.id).join(',')).split(','))
    .filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 2);
  const [plan, users] = await Promise.all([
    load<ApprovalPlan>(`/documents/${encodeURIComponent(number)}/approval-plan?approvers=${encodeURIComponent(chosen.join(','))}`),
    loadOrNull<UserRow[]>('/users')
  ]);
  const candidates = (users ?? []).filter((u) => u.status === 'active' && (u.roles.includes('qm') || u.roles.includes('approver')));
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><a href="/documents">Documents</a><span>/</span><a href={`/documents/${d.number}`}>{d.number}</a><span>/</span><span>Verify and send</span></nav>
      <h1 className="mb-16">Verify and send {d.number} v{d.current.version}</h1>
      <Notice err={sp.err} />
      {!d.can.send ? <div className="callout warn mb-16">This document can’t be sent now: it must be in Review closed, and you must be its owner, author or a Quality Manager.</div> : null}
      <SendForm
        plan={plan} pdfHref={`/files/documents/${d.number}/pdf`} replanAction={`/documents/${d.number}/send`} approverCount={2}
        chosen={chosen} candidates={candidates} labels={{
          footer: `The footer shows ${d.number}, version ${d.current.version} and “Page X of Y” on every page`,
          version: `The version on the cover and in the agreement subject is v${d.current.version}`,
          documentId: `The document ID ${d.number} is correct throughout, including the title block`,
          dates: 'Dates are correct: issue date, review date and any dates in the text'
        }}
        action={sendAgreement.bind(null, d.number, chosen)} disabled={!d.can.send} />
    </>
  );
}
