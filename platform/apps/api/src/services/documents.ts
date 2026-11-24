// Document control (PJ's amendment flow, 24 Nov 2026): every amendment starts as a change request; Draft → submit
// (the PDF is locked and the four checks made on it) → In review → In approval (QA approvers approve in VeQMS and
// decide on retraining) → Signing (one Adobe Sign agreement with every signer, sent on the last approval) → Effective.
// A reviewer or approver can return the draft to its author at any point before signing.
import { createHash } from 'node:crypto';
import { rows, one, maybe, type Db } from '@veqms/db';
import { DOC_TYPES, can, canBeApprover, verificationComplete, type Role, type Verification } from '@veqms/domain';
import type { Storage } from '../integrations/storage.ts';
import { checkPlan, documentPlan, renderDocumentPdf } from './plans.ts';
import { badRequest, conflict, forbidden, logged, notFound } from '../lib/http.ts';
import { canSee, people, ref, type Person } from '../lib/people.ts';
import { addTask, audit, closeTasks, notify, dueIn } from '../lib/work.ts';
import { allocateDocument, audienceOf, setAudience } from './training.ts';

export type Block = { t: 'h' | 'p'; x: string };
export const sha256 = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

export interface DocRow {
  id: string; number: string; doc_type: string; title: string; state: string; classification: string; owner_id: string; author_id: string;
  process: string; tags: string[]; effective_at: Date | null; approval_due: Date | null; review_due: Date | null; updated_at: Date; periodic_months: number;
}
export interface VersionRow { id: string; version: string; kind: string; state: string; summary: string; content: Block[]; content_sha256: string; created_at: Date; approved_at: Date | null; agreement_id: string | null; migrated_from: string | null;
  pdf_blob: string | null; verification: (Verification & { by: string; at: string }) | null; retrain: boolean; retrain_reason: string | null; change_request_id: string | null }

// Every amendment starts as a change request (Phase 1 keeps it minimal: it is opened with the version it produces and
// closes when that version is Effective; full change control is Phase 2).
async function openChangeRequest(db: Db, me: Person, d: { number: string; title: string; process: string }, versionId: string, version: string, why: string, size: 'Major' | 'Minor'): Promise<string> {
  const cr = await one<{ id: string; number: string }>(db, `insert into app.change_requests (tenant_id, number, title, size, state, owner_id, process, description, reason)
    values (app.current_tenant(), app.next_number('CR'), $1, $2, 'In execution', $3, $4, $5, $5) returning id, number`,
    [`${d.number} v${version}: ${d.title}`.slice(0, 200), size, me.id, d.process, why]);
  await db.query('update app.document_versions set change_request_id = $2 where id = $1', [versionId, cr.id]);
  await audit(db, 'create', 'Change request', cr.number, `Opened ${cr.number} for ${d.number} v${version}: ${why}`, null, { document: d.number, version, size });
  return cr.number;
}

// Every PDF open is logged with the version it showed. Trainees must have opened the version before they confirm.
export async function logPdfOpen(db: Db, d: { number: string }, v: { id: string; version: string }): Promise<void> {
  await audit(db, 'read', 'Document', d.number, `Opened the PDF of ${d.number} v${v.version}`, null, { versionId: v.id, version: v.version });
}

export async function docByNumber(db: Db, number: string): Promise<DocRow> {
  const d = await maybe<DocRow>(db, 'select * from app.documents where number = $1', [number]);
  if (!d) throw notFound(`Document ${number} doesn’t exist.`);
  return d;
}
export async function currentVersion(db: Db, documentId: string): Promise<VersionRow> {
  return one<VersionRow>(db, 'select * from app.document_versions where document_id = $1 order by created_at desc limit 1', [documentId]);
}
async function involved(db: Db, d: DocRow, userId: string): Promise<boolean> {
  if (d.owner_id === userId || d.author_id === userId) return true;
  const r = await maybe(db, 'select 1 from app.document_reviewers where document_id = $1 and user_id = $2 union all select 1 from app.document_approvers where document_id = $1 and user_id = $2 limit 1', [d.id, userId]);
  return !!r;
}
export async function assertVisible(db: Db, me: Person, d: DocRow): Promise<void> {
  if (!canSee(me, d.classification, await involved(db, d, me.id))) {
    throw logged(forbidden(`${d.number} is ${d.classification}. You need ${d.classification} clearance or named access.`),
      { action: 'read.denied', objectType: 'Document', objectId: d.number, summary: `Access denied: ${d.number} is ${d.classification}` });
  }
}

async function setState(db: Db, d: DocRow, v: VersionRow, state: string, summary: string): Promise<void> {
  await db.query('update app.documents set state = $2 where id = $1', [d.id, state]);
  if (!['Superseded', 'Obsolete'].includes(state)) await db.query('update app.document_versions set state = $2 where id = $1', [v.id, state]);
  await audit(db, 'state', 'Document', d.number, summary, { state: d.state }, { state });
  if (d.owner_id) await notify(db, { to: [d.owner_id], kind: 'info', title: `${d.number} is now ${state}`, body: d.title, recordType: 'document', recordId: d.id, href: `/documents/${d.number}`, email: false });
  d.state = state;
}

export async function list(db: Db, me: Person, f: { state?: string; type?: string; q?: string }) {
  const list = await rows<DocRow & { current_version: string; effective_version: string | null; owner_name: string; involved: boolean }>(db, `
    select d.*, u.name as owner_name,
      (select v.version from app.document_versions v where v.document_id = d.id order by v.created_at desc limit 1) as current_version,
      (select v.version from app.document_versions v where v.document_id = d.id and v.state = 'Effective' limit 1) as effective_version,
      (d.owner_id = $4 or d.author_id = $4 or exists (select 1 from app.document_reviewers r where r.document_id = d.id and r.user_id = $4)
        or exists (select 1 from app.document_approvers a where a.document_id = d.id and a.user_id = $4)) as involved
    from app.documents d join app.users u on u.id = d.owner_id
    where ($1::text is null or d.state = $1) and ($2::text is null or d.doc_type = $2)
      and ($3::text is null or (d.number || ' ' || d.title || ' ' || array_to_string(d.tags, ' ')) ilike '%' || $3 || '%')
    order by d.number`, [f.state ?? null, f.type ?? null, f.q ?? null, me.id]);
  return list.filter((d) => canSee(me, d.classification, d.involved)).map((d) => ({
    id: d.id, number: d.number, title: d.title, docType: d.doc_type, state: d.state, classification: d.classification,
    owner: { id: d.owner_id, name: d.owner_name }, currentVersion: d.current_version, effectiveVersion: d.effective_version, updatedAt: new Date(d.updated_at).toISOString()
  }));
}

export async function detail(db: Db, me: Person, number: string, agreementSummary: (db: Db, recordId: string) => Promise<unknown>) {
  const d = await docByNumber(db, number);
  await assertVisible(db, me, d);
  const versions = await rows<VersionRow>(db, 'select * from app.document_versions where document_id = $1 order by created_at', [d.id]);
  const cur = versions[versions.length - 1]!;
  const reviewers = await rows<{ user_id: string; name: string; status: string; reviewed_at: Date | null }>(db, 'select r.user_id, u.name, r.status, r.reviewed_at from app.document_reviewers r join app.users u on u.id = r.user_id where r.document_id = $1 order by u.name', [d.id]);
  const approvers = await rows<{ user_id: string; name: string; position: number; status: string; decided_at: Date | null; retrain: boolean | null; retrain_reason: string | null }>(db,
    'select a.user_id, u.name, a.position, a.status, a.decided_at, a.retrain, a.retrain_reason from app.document_approvers a join app.users u on u.id = a.user_id where a.document_id = $1 order by a.position', [d.id]);
  const cr = cur.change_request_id ? await maybe<{ number: string; state: string }>(db, 'select number, state from app.change_requests where id = $1', [cur.change_request_id]) : null;
  const [owner, author] = await people(db, [d.owner_id, d.author_id]).then((ps) => [ps.find((p) => p.id === d.owner_id), ps.find((p) => p.id === d.author_id)]);
  const aud = await audienceOf(db, d.id);
  const env = (await agreementSummary(db, d.id)) as { status?: string; signers?: { userId: string; status: string }[]; sentBy?: { id: string } } | null;
  const ro = !can(me.roles, 'write');
  const mine = (id: string) => id === me.id;
  return {
    id: d.id, number: d.number, title: d.title, docType: d.doc_type, state: d.state, classification: d.classification, process: d.process, tags: d.tags,
    owner: ref(owner), author: ref(author), effectiveAt: d.effective_at, approvalDue: d.approval_due,
    versions: versions.map((v) => ({ id: v.id, version: v.version, kind: v.kind, state: v.state, summary: v.summary, createdAt: v.created_at, approvedAt: v.approved_at, agreementId: v.agreement_id, migratedFrom: v.migrated_from })),
    current: { version: cur.version, state: cur.state, summary: cur.summary, content: cur.content, contentSha256: cur.content_sha256,
      pdf: cur.pdf_blob ? { sha256: cur.content_sha256, checkedAt: cur.verification?.at ?? null } : null,
      retrain: cur.retrain, retrainReason: cur.retrain_reason, changeRequest: cr },
    reviewers: reviewers.map((r) => ({ user: { id: r.user_id, name: r.name }, status: r.status, reviewedAt: r.reviewed_at })),
    approvers: approvers.map((a) => ({ user: { id: a.user_id, name: a.name }, position: a.position, status: a.status, decidedAt: a.decided_at, retrain: a.retrain, retrainReason: a.retrain_reason })),
    audience: { groups: aud.groups, roles: aud.roles, users: aud.userRefs, daysToComplete: aud.daysToComplete, quiz: aud.quiz },
    agreement: env,
    can: {
      edit: !ro && d.state === 'Draft' && (mine(d.author_id) || mine(d.owner_id)),
      submit: !ro && d.state === 'Draft' && (mine(d.author_id) || mine(d.owner_id)),
      review: !ro && d.state === 'In review' && reviewers.some((r) => r.user_id === me.id && r.status === 'Pending'),
      approve: !ro && d.state === 'In approval' && approvers.some((a) => a.user_id === me.id && a.status === 'To approve'),
      sendBack: !ro && ['In review', 'In approval'].includes(d.state) && (reviewers.some((r) => r.user_id === me.id) || approvers.some((a) => a.user_id === me.id) || mine(d.owner_id) || mine(d.author_id) || me.roles.includes('qm')),
      sign: !!env && env.status === 'sent' && !!env.signers?.some((s) => s.userId === me.id && s.status === 'sent'),
      cancel: !ro && !!env && env.status === 'sent' && (env.sentBy?.id === me.id || mine(d.owner_id) || me.roles.includes('qm')),
      newVersion: !ro && d.state === 'Effective' && (mine(d.owner_id) || mine(d.author_id) || me.roles.includes('qm')),
      changeAudience: !ro && (me.roles.includes('qm') || mine(d.owner_id))
    }
  };
}

export async function create(db: Db, me: Person, input: { docType: string; title: string; classification: string; ownerId: string; process: string; tags?: string[];
  audience?: { groups: string[]; roles: Role[]; users: string[]; daysToComplete: number; quiz: boolean } }) {
  if (!can(me.roles, 'doc.create')) throw forbidden('Your role can’t create documents.');
  const t = DOC_TYPES.find((x) => x.type === input.docType);
  if (!t) throw badRequest('Unknown document type.');
  const number = (await one<{ n: string }>(db, 'select app.next_number($1) as n', [t.prefix])).n;
  const tpl = await maybe<{ id: string; sections: string[] }>(db, "select id, sections from app.templates where doc_type = $1 and state = 'Effective' order by version desc limit 1", [input.docType]);
  const content: Block[] = (tpl?.sections ?? ['1. Purpose']).flatMap((s) => [{ t: 'h' as const, x: s }, { t: 'p' as const, x: '[Write this section.]' }]);
  const d = await one<{ id: string }>(db, `insert into app.documents (tenant_id, number, doc_type, title, classification, owner_id, author_id, process, template_id, tags)
    values (app.current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [number, input.docType, input.title, input.classification, input.ownerId, me.id, input.process, tpl?.id ?? null, input.tags ?? []]);
  const v0 = await one<{ id: string }>(db, `insert into app.document_versions (tenant_id, document_id, version, kind, state, summary, content, content_sha256, created_by)
    values (app.current_tenant(), $1, '0.1', 'major', 'Draft', 'First draft.', $2, $3, $4) returning id`, [d.id, JSON.stringify(content), sha256(content), me.id]);
  await audit(db, 'create', 'Document', number, `Created ${number} ${input.title}${tpl ? ' from the approved template' : ''}`, null, { title: input.title, classification: input.classification });
  await openChangeRequest(db, me, { number, title: input.title, process: input.process }, v0.id, '0.1', 'New document', 'Major');
  if (input.audience) await setAudience(db, me, d.id, input.audience);
  await addTask(db, { kind: 'author', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: me.id, dueAt: dueIn(7) });
  return { id: d.id, number };
}

export async function saveDraft(db: Db, me: Person, number: string, content: Block[], summary: string) {
  const d = await docByNumber(db, number);
  if (d.state !== 'Draft') throw conflict('Only a draft can be edited.');
  if (![d.author_id, d.owner_id].includes(me.id)) throw forbidden('Only the author or owner can edit the draft.');
  const v = await currentVersion(db, d.id);
  // A PDF made from the old text no longer matches it: it has to be made and checked again.
  await db.query('update app.document_versions set content = $2, content_sha256 = $3, summary = $4, pdf_blob = null, verification = null where id = $1', [v.id, JSON.stringify(content), sha256(content), summary]);
  await audit(db, 'checkin', 'Document', number, `Saved draft v${v.version}: ${summary}`, { sha256: v.content_sha256 }, { sha256: sha256(content) });
}

// Submit, step 1: choose reviewers and QA approvers, then convert the draft to PDF, hash it and lock it. The PDF carries
// a signature field for each signer, so it is made once the signers are known. From here the locked PDF is what is
// checked, reviewed, approved, signed and published; content_sha256 becomes its hash. Editing the draft clears it.
export async function preparePdf(db: Db, me: Person, storage: Storage, number: string, reviewerIds: string[], approverIds: string[]) {
  const d = await docByNumber(db, number);
  if (d.state !== 'Draft') throw conflict('Only a draft can be submitted.');
  if (![d.author_id, d.owner_id].includes(me.id)) throw forbidden('Only the author or owner can submit it.');
  if (!approverIds.length || approverIds.length > 2) throw badRequest('Choose one or two QA approvers.');
  if (new Set(approverIds).size !== approverIds.length) throw badRequest('Choose two different QA approvers.');
  const reviewers = [...new Set(reviewerIds)];
  const v = await currentVersion(db, d.id);
  // Segregation of duties is checked here, where the approvers are chosen: a refusal is logged.
  const { plan, people: ps } = await documentPlan(db, d, v.version, { reviewers, approvers: approverIds });
  await checkPlan(db, plan, 'document', d.number, 'Submit refused');
  const ap = ps.filter((p) => approverIds.includes(p.id));
  if (ap.some((p) => !canBeApprover(p.roles) || p.status !== 'active')) throw badRequest('Each QA approver must be an active Approver or Quality Manager.');
  await db.query('delete from app.document_reviewers where document_id = $1', [d.id]);
  await db.query('delete from app.document_approvers where document_id = $1', [d.id]);
  for (const r of reviewers) await db.query(`insert into app.document_reviewers (tenant_id, document_id, user_id) values (app.current_tenant(), $1, $2)`, [d.id, r]);
  for (const [i, a] of approverIds.entries()) await db.query(`insert into app.document_approvers (tenant_id, document_id, user_id, position) values (app.current_tenant(), $1, $2, $3)`, [d.id, a, i + 1]);
  const pdf = await renderDocumentPdf(db, d, v, plan, ps);
  const sha = createHash('sha256').update(pdf).digest('hex');
  const key = `documents/${d.id}/v${v.version}-${sha.slice(0, 16)}.pdf`;
  await storage.put(key, pdf, 'application/pdf');
  await db.query('update app.document_versions set pdf_blob = $2, content_sha256 = $3, verification = null where id = $1', [v.id, key, sha]);
  await audit(db, 'pdf.lock', 'Document', number, `Converted v${v.version} to PDF and locked it for checking`, { sha256: v.content_sha256 }, { pdfSha256: sha, signers: plan.signers.length });
  return { sha256: sha };
}

// Submit, step 2: the author has checked the locked PDF (footer, version, document ID, dates). pdfSha256 is the hash
// of the PDF they were shown, so a PDF made again in the meantime is refused rather than submitted unchecked.
export async function submit(db: Db, me: Person, number: string, verification: Verification, pdfSha256: string) {
  const d = await docByNumber(db, number);
  if (d.state !== 'Draft') throw conflict('Only a draft can be submitted.');
  if (![d.author_id, d.owner_id].includes(me.id)) throw forbidden('Only the author or owner can submit it.');
  if (!verificationComplete(verification)) throw badRequest('Check the PDF and tick all four checks (footer, version, document ID, dates) before submitting.');
  const v = await currentVersion(db, d.id);
  if (!v.pdf_blob) throw conflict('Make the PDF and check it before submitting.');
  if (v.content_sha256 !== pdfSha256) throw conflict('The PDF changed after you opened it. Check the new PDF and submit again.');
  const { plan } = await documentPlan(db, d, v.version); // roles or accounts may have changed since the PDF was made
  await checkPlan(db, plan, 'document', d.number, 'Submit refused');
  const checks = { footer: true, version: true, documentId: true, dates: true, note: verification.note ?? '', by: me.id, at: new Date().toISOString() };
  await db.query('update app.document_versions set verification = $2 where id = $1', [v.id, JSON.stringify(checks)]);
  await audit(db, 'submit', 'Document', number, `Submitted v${v.version}: locked PDF checked (footer, version, document ID, dates)`, null, { pdfSha256: v.content_sha256, verification: checks });
  await closeTasks(db, { recordId: d.id, kinds: ['author', 'resubmit'] });
  const reviewers = (await rows<{ user_id: string }>(db, 'select user_id from app.document_reviewers where document_id = $1', [d.id])).map((r) => r.user_id);
  if (!reviewers.length) { await startApproval(db, d, `Submitted v${v.version} (no reviewers)`); return; }
  await db.query(`update app.document_reviewers set status = 'Pending', reviewed_at = null where document_id = $1`, [d.id]);
  await db.query('update app.documents set review_due = $2 where id = $1', [d.id, dueIn(5)]);
  await setState(db, d, v, 'In review', `Submitted v${v.version} for review`);
  const approvers = (await rows<{ user_id: string }>(db, 'select user_id from app.document_approvers where document_id = $1', [d.id])).map((r) => r.user_id);
  for (const r of reviewers) await addTask(db, { kind: 'review-doc', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: r, dueAt: dueIn(5) });
  for (const a of approvers) await addTask(db, { kind: 'fyi', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: a, dueAt: dueIn(9), fyi: true, note: 'You approve in VeQMS after review, then sign in Adobe Sign' });
  await notify(db, { to: reviewers, kind: 'action', title: `Please review ${number} v${v.version}`, body: d.title, recordType: 'document', recordId: d.id, href: `/documents/${number}` });
}

// Review done (or no reviewers): the QA approvers approve in VeQMS.
async function startApproval(db: Db, d: DocRow, summary: string): Promise<void> {
  await setState(db, d, await currentVersion(db, d.id), 'In approval', summary);
  await db.query(`update app.document_approvers set status = 'To approve' where document_id = $1`, [d.id]);
  const ap = await rows<{ user_id: string }>(db, 'select user_id from app.document_approvers where document_id = $1 order by position', [d.id]);
  await closeTasks(db, { recordId: d.id, kinds: ['fyi'] });
  for (const a of ap) await addTask(db, { kind: 'approve-doc', recordType: 'document', recordId: d.id, recordNumber: d.number, assigneeId: a.user_id, dueAt: dueIn(3), note: 'Approve in VeQMS and decide whether retraining is needed' });
  await notify(db, { to: ap.map((a) => a.user_id), kind: 'action', title: `Please approve ${d.number}`, body: 'Review is complete. When the last approver approves, the agreement goes to Adobe Sign for signing.', recordType: 'document', recordId: d.id, href: `/documents/${d.number}` });
}

export async function review(db: Db, me: Person, number: string, comment?: string) {
  const d = await docByNumber(db, number);
  if (d.state !== 'In review') throw conflict('This document isn’t in review.');
  const r = await db.query(`update app.document_reviewers set status = 'Reviewed', reviewed_at = now(), comment = $3 where document_id = $1 and user_id = $2 and status = 'Pending'`, [d.id, me.id, comment ?? null]);
  if (!r.rowCount) throw forbidden('You aren’t a pending reviewer on this document.');
  await audit(db, 'review', 'Document', number, 'Marked reviewed' + (comment ? ' with a comment' : ''));
  await closeTasks(db, { recordId: d.id, kinds: ['review-doc'], assigneeId: me.id });
  const left = await maybe(db, `select 1 from app.document_reviewers where document_id = $1 and status <> 'Reviewed' limit 1`, [d.id]);
  if (!left) await startApproval(db, d, 'Review complete: all reviewers done');
}

// A QA approver approves in VeQMS and decides whether the change needs retraining (the default; "no" needs a reason).
// When the last approver approves, send() puts the locked PDF out for signing at once.
export async function approve(db: Db, me: Person, number: string, input: { retrain: boolean; reason?: string; comment?: string }, send: (db: Db, by: Person, number: string) => Promise<unknown>) {
  const d = await docByNumber(db, number);
  if (d.state !== 'In approval') throw conflict('This document isn’t waiting for approval.');
  const reason = (input.reason ?? '').trim();
  if (!input.retrain && reason.length < 10) throw badRequest('Say why no retraining is needed (at least a short sentence).');
  const r = await db.query(`update app.document_approvers set status = 'Approved', decided_at = now(), retrain = $3, retrain_reason = $4, comment = $5
    where document_id = $1 and user_id = $2 and status = 'To approve'`, [d.id, me.id, input.retrain, input.retrain ? null : reason, input.comment ?? null]);
  if (!r.rowCount) throw forbidden('You aren’t a QA approver waiting to approve this document.');
  const v = await currentVersion(db, d.id);
  await audit(db, 'approve', 'Document', number, `Approved v${v.version} in VeQMS; ${input.retrain ? 'retraining needed' : 'no retraining needed: ' + reason}`, null, { retrain: input.retrain, reason: input.retrain ? null : reason });
  await closeTasks(db, { recordId: d.id, kinds: ['approve-doc'], assigneeId: me.id });
  const all = await rows<{ status: string; retrain: boolean | null; retrain_reason: string | null }>(db, 'select status, retrain, retrain_reason from app.document_approvers where document_id = $1', [d.id]);
  if (all.some((a) => a.status !== 'Approved')) return { sent: false };
  // Retraining unless every approver decided it isn't needed.
  const retrain = all.some((a) => a.retrain !== false);
  await db.query('update app.document_versions set retrain = $2, retrain_reason = $3 where id = $1', [v.id, retrain, retrain ? null : all.map((a) => a.retrain_reason).filter(Boolean).join(' · ')]);
  await send(db, me, number);
  return { sent: true };
}

// Return the draft to its author: a reviewer or approver (or the owner, author or a Quality Manager) before signing.
export async function sendBack(db: Db, me: Person, number: string, reason: string) {
  const d = await docByNumber(db, number);
  if (!['In review', 'In approval'].includes(d.state)) throw conflict('Only a document in review or approval can be returned. Cancel an agreement that is out for signing instead.');
  const onIt = await maybe(db, `select 1 from app.document_reviewers where document_id = $1 and user_id = $2 union all select 1 from app.document_approvers where document_id = $1 and user_id = $2 limit 1`, [d.id, me.id]);
  if (!onIt && ![d.owner_id, d.author_id].includes(me.id) && !me.roles.includes('qm')) throw forbidden('Only a reviewer, an approver, the owner, the author or a Quality Manager can return it.');
  await db.query(`update app.document_reviewers set status = 'Not started', reviewed_at = null where document_id = $1`, [d.id]);
  await db.query(`update app.document_approvers set status = 'Waiting', decided_at = null, retrain = null, retrain_reason = null, comment = null where document_id = $1`, [d.id]);
  await setState(db, d, await currentVersion(db, d.id), 'Draft', `Returned to the author by ${me.name}. Reason: ${reason}`);
  await closeTasks(db, { recordId: d.id, kinds: ['review-doc', 'approve-doc', 'fyi'] });
  await addTask(db, { kind: 'resubmit', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: d.author_id, dueAt: dueIn(5), note: 'Reason: ' + reason });
  await notify(db, { to: [d.author_id], kind: 'warn', title: `${number} was returned to you`, body: 'Reason: ' + reason, recordType: 'document', recordId: d.id, href: `/documents/${number}` });
}

export async function newVersion(db: Db, me: Person, number: string, kind: 'major' | 'minor', summary: string) {
  const d = await docByNumber(db, number);
  if (d.state !== 'Effective') throw conflict('Start a new version from the effective one.');
  const cur = await currentVersion(db, d.id);
  const [M, m] = cur.version.split('.').map(Number) as [number, number];
  const nv = kind === 'major' ? `${M + 1}.0` : `${M}.${m + 1}`;
  const v = await one<{ id: string }>(db, `insert into app.document_versions (tenant_id, document_id, version, kind, state, summary, content, content_sha256, created_by)
    values (app.current_tenant(), $1, $2, $3, 'Draft', $4, $5, $6, $7) returning id`, [d.id, nv, kind, summary, JSON.stringify(cur.content), sha256(cur.content), me.id]);
  await db.query(`update app.documents set state = 'Draft', author_id = $2 where id = $1`, [d.id, me.id]);
  await audit(db, 'version', 'Document', number, `Started ${kind} version v${nv} of ${number}: ${summary}`, { state: 'Effective' }, { state: 'Draft', version: nv });
  const cr = await openChangeRequest(db, me, d, v.id, nv, summary, kind === 'major' ? 'Major' : 'Minor');
  await addTask(db, { kind: 'author', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: me.id, dueAt: dueIn(7) });
  return { version: nv, changeRequest: cr };
}

// Called when the approval agreement completes.
export async function makeEffective(db: Db, documentId: string, versionId: string): Promise<number> {
  const d = await one<DocRow>(db, 'select * from app.documents where id = $1', [documentId]);
  const v = await one<VersionRow>(db, 'select * from app.document_versions where id = $1', [versionId]);
  await db.query(`update app.document_versions set state = 'Superseded' where document_id = $1 and state = 'Effective' and id <> $2`, [documentId, versionId]);
  await db.query('update app.documents set effective_at = now() where id = $1', [documentId]);
  await setState(db, d, v, 'Effective', `${d.number} v${v.version} is Effective`);
  await closeTasks(db, { recordId: documentId, kinds: ['fyi', 'esign', 'approve-doc'] });
  if (v.change_request_id) {
    const cr = await maybe<{ number: string }>(db, `update app.change_requests set state = 'Closed', closed_at = now() where id = $1 and state <> 'Closed' returning number`, [v.change_request_id]);
    if (cr) await audit(db, 'state', 'Change request', cr.number, `${cr.number} closed: ${d.number} v${v.version} is Effective`, { state: 'In execution' }, { state: 'Closed' });
  }
  const next = new Date(Date.now() + Math.round(d.periodic_months * 30.4) * 86_400_000);
  await db.query(`insert into app.periodic_reviews (tenant_id, number, document_id, reviewer_id, due_at) values (app.current_tenant(), app.next_number('PR'), $1, $2, $3)`, [documentId, d.owner_id, next]);
  return allocateDocument(db, documentId, 'New version effective', null);
}
