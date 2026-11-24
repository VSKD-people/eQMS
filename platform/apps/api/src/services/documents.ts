// Document control: Draft → In review → Review closed → (DocuSign envelope) In approval → Effective.
import { createHash } from 'node:crypto';
import { rows, one, maybe, type Db } from '@veqms/db';
import { DOC_TYPES, can, canBeApprover, type Role } from '@veqms/domain';
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
export interface VersionRow { id: string; version: string; kind: string; state: string; summary: string; content: Block[]; content_sha256: string; created_at: Date; approved_at: Date | null; envelope_id: string | null; migrated_from: string | null }

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

export async function detail(db: Db, me: Person, number: string, envelopeSummary: (db: Db, recordId: string) => Promise<unknown>) {
  const d = await docByNumber(db, number);
  await assertVisible(db, me, d);
  const versions = await rows<VersionRow>(db, 'select * from app.document_versions where document_id = $1 order by created_at', [d.id]);
  const cur = versions[versions.length - 1]!;
  const reviewers = await rows<{ user_id: string; name: string; status: string; reviewed_at: Date | null }>(db, 'select r.user_id, u.name, r.status, r.reviewed_at from app.document_reviewers r join app.users u on u.id = r.user_id where r.document_id = $1 order by u.name', [d.id]);
  const approvers = await rows<{ user_id: string; name: string; position: number; status: string }>(db, 'select a.user_id, u.name, a.position, a.status from app.document_approvers a join app.users u on u.id = a.user_id where a.document_id = $1 order by a.position', [d.id]);
  const [owner, author] = await people(db, [d.owner_id, d.author_id]).then((ps) => [ps.find((p) => p.id === d.owner_id), ps.find((p) => p.id === d.author_id)]);
  const aud = await audienceOf(db, d.id);
  const env = (await envelopeSummary(db, d.id)) as { status?: string; signers?: { userId: string; status: string }[]; sentBy?: { id: string } } | null;
  const ro = !can(me.roles, 'write');
  const mine = (id: string) => id === me.id;
  return {
    id: d.id, number: d.number, title: d.title, docType: d.doc_type, state: d.state, classification: d.classification, process: d.process, tags: d.tags,
    owner: ref(owner), author: ref(author), effectiveAt: d.effective_at, approvalDue: d.approval_due,
    versions: versions.map((v) => ({ id: v.id, version: v.version, kind: v.kind, state: v.state, summary: v.summary, createdAt: v.created_at, approvedAt: v.approved_at, envelopeId: v.envelope_id, migratedFrom: v.migrated_from })),
    current: { version: cur.version, state: cur.state, summary: cur.summary, content: cur.content, contentSha256: cur.content_sha256 },
    reviewers: reviewers.map((r) => ({ user: { id: r.user_id, name: r.name }, status: r.status, reviewedAt: r.reviewed_at })),
    approvers: approvers.map((a) => ({ user: { id: a.user_id, name: a.name }, position: a.position, status: a.status })),
    audience: { groups: aud.groups, roles: aud.roles, users: aud.userRefs, daysToComplete: aud.daysToComplete, quiz: aud.quiz },
    envelope: env,
    can: {
      edit: !ro && d.state === 'Draft' && (mine(d.author_id) || mine(d.owner_id)),
      submit: !ro && d.state === 'Draft' && (mine(d.author_id) || mine(d.owner_id)),
      review: !ro && d.state === 'In review' && reviewers.some((r) => r.user_id === me.id && r.status === 'Pending'),
      sendBack: !ro && ((d.state === 'In review' && reviewers.some((r) => r.user_id === me.id)) || (d.state === 'Review closed' && (mine(d.owner_id) || mine(d.author_id) || me.roles.includes('qm')))),
      send: !ro && d.state === 'Review closed' && (mine(d.owner_id) || mine(d.author_id) || me.roles.includes('qm')),
      sign: !!env && env.status === 'sent' && !!env.signers?.some((s) => s.userId === me.id && (s.status === 'sent' || s.status === 'delivered')),
      void: !ro && !!env && env.status === 'sent' && (env.sentBy?.id === me.id || mine(d.owner_id) || me.roles.includes('qm')),
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
  await db.query(`insert into app.document_versions (tenant_id, document_id, version, kind, state, summary, content, content_sha256, created_by)
    values (app.current_tenant(), $1, '0.1', 'major', 'Draft', 'First draft.', $2, $3, $4)`, [d.id, JSON.stringify(content), sha256(content), me.id]);
  await audit(db, 'create', 'Document', number, `Created ${number} ${input.title}${tpl ? ' from the approved template' : ''}`, null, { title: input.title, classification: input.classification });
  if (input.audience) await setAudience(db, me, d.id, input.audience);
  await addTask(db, { kind: 'author', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: me.id, dueAt: dueIn(7) });
  return { id: d.id, number };
}

export async function saveDraft(db: Db, me: Person, number: string, content: Block[], summary: string) {
  const d = await docByNumber(db, number);
  if (d.state !== 'Draft') throw conflict('Only a draft can be edited.');
  if (![d.author_id, d.owner_id].includes(me.id)) throw forbidden('Only the author or owner can edit the draft.');
  const v = await currentVersion(db, d.id);
  await db.query('update app.document_versions set content = $2, content_sha256 = $3, summary = $4 where id = $1', [v.id, JSON.stringify(content), sha256(content), summary]);
  await audit(db, 'checkin', 'Document', number, `Saved draft v${v.version}: ${summary}`, { sha256: v.content_sha256 }, { sha256: sha256(content) });
}

export async function submit(db: Db, me: Person, number: string, reviewerIds: string[], approverIds: string[]) {
  const d = await docByNumber(db, number);
  if (d.state !== 'Draft') throw conflict('Only a draft can be submitted.');
  if (![d.author_id, d.owner_id].includes(me.id)) throw forbidden('Only the author or owner can submit it.');
  if (!approverIds.length || approverIds.length > 2) throw badRequest('Choose one or two QA approvers.');
  if (approverIds.some((a) => reviewerIds.includes(a))) throw badRequest('A QA approver can’t also be a reviewer.');
  const ap = await people(db, approverIds);
  if (ap.length !== new Set(approverIds).size || ap.some((p) => !canBeApprover(p.roles) || p.status !== 'active')) throw badRequest('Each QA approver must be an active Approver or Quality Manager.');
  const v = await currentVersion(db, d.id);
  await db.query('delete from app.document_reviewers where document_id = $1', [d.id]);
  await db.query('delete from app.document_approvers where document_id = $1', [d.id]);
  for (const r of new Set(reviewerIds)) await db.query(`insert into app.document_reviewers (tenant_id, document_id, user_id, status) values (app.current_tenant(), $1, $2, 'Pending')`, [d.id, r]);
  for (const [i, a] of approverIds.entries()) await db.query(`insert into app.document_approvers (tenant_id, document_id, user_id, position) values (app.current_tenant(), $1, $2, $3)`, [d.id, a, i + 1]);
  await closeTasks(db, { recordId: d.id, kinds: ['author', 'resubmit'] });
  if (!reviewerIds.length) { await setState(db, d, v, 'Review closed', `Submitted v${v.version} (no reviewers)`); await readyToSend(db, d); return; }
  await db.query('update app.documents set review_due = $2 where id = $1', [d.id, dueIn(5)]);
  await setState(db, d, v, 'In review', `Submitted v${v.version} for review`);
  for (const r of new Set(reviewerIds)) await addTask(db, { kind: 'review-doc', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: r, dueAt: dueIn(5) });
  for (const a of approverIds) await addTask(db, { kind: 'fyi', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: a, dueAt: dueIn(9), fyi: true, note: 'You sign in DocuSign after review' });
  await notify(db, { to: reviewerIds, kind: 'action', title: `Please review ${number} v${v.version}`, body: d.title, recordType: 'document', recordId: d.id, href: `/documents/${number}` });
}

async function readyToSend(db: Db, d: DocRow): Promise<void> {
  await addTask(db, { kind: 'send-approval', recordType: 'document', recordId: d.id, recordNumber: d.number, assigneeId: d.owner_id, dueAt: dueIn(2), note: 'Verify the PDF, then send one DocuSign envelope' });
  await notify(db, { to: [d.owner_id], kind: 'action', title: `${d.number} is ready to send for DocuSign approval`, body: 'Check the footer, version, document ID and dates first: a correction after sending costs a second send.', recordType: 'document', recordId: d.id, href: `/documents/${d.number}/send` });
}

export async function review(db: Db, me: Person, number: string, comment?: string) {
  const d = await docByNumber(db, number);
  if (d.state !== 'In review') throw conflict('This document isn’t in review.');
  const r = await db.query(`update app.document_reviewers set status = 'Reviewed', reviewed_at = now(), comment = $3 where document_id = $1 and user_id = $2 and status = 'Pending'`, [d.id, me.id, comment ?? null]);
  if (!r.rowCount) throw forbidden('You aren’t a pending reviewer on this document.');
  await audit(db, 'review', 'Document', number, 'Marked reviewed' + (comment ? ' with a comment' : ''));
  await closeTasks(db, { recordId: d.id, kinds: ['review-doc'], assigneeId: me.id });
  const left = await maybe(db, `select 1 from app.document_reviewers where document_id = $1 and status <> 'Reviewed' limit 1`, [d.id]);
  if (!left) { await setState(db, d, await currentVersion(db, d.id), 'Review closed', 'Review closed: all reviewers done'); await readyToSend(db, d); }
}

export async function sendBack(db: Db, me: Person, number: string, reason: string) {
  const d = await docByNumber(db, number);
  if (!['In review', 'Review closed'].includes(d.state)) throw conflict('Only a document in review or review closed can be sent back. Void an envelope that is out for signature instead.');
  await db.query(`update app.document_reviewers set status = 'Not started', reviewed_at = null where document_id = $1`, [d.id]);
  await setState(db, d, await currentVersion(db, d.id), 'Draft', `Sent back to draft by ${me.name}. Reason: ${reason}`);
  await closeTasks(db, { recordId: d.id, kinds: ['review-doc', 'send-approval', 'fyi'] });
  await addTask(db, { kind: 'resubmit', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: d.author_id, dueAt: dueIn(5), note: 'Reason: ' + reason });
  await notify(db, { to: [d.author_id], kind: 'warn', title: `${number} was sent back`, body: 'Reason: ' + reason, recordType: 'document', recordId: d.id, href: `/documents/${number}` });
}

export async function newVersion(db: Db, me: Person, number: string, kind: 'major' | 'minor', summary: string) {
  const d = await docByNumber(db, number);
  if (d.state !== 'Effective') throw conflict('Start a new version from the effective one.');
  const cur = await currentVersion(db, d.id);
  const [M, m] = cur.version.split('.').map(Number) as [number, number];
  const nv = kind === 'major' ? `${M + 1}.0` : `${M}.${m + 1}`;
  await db.query(`insert into app.document_versions (tenant_id, document_id, version, kind, state, summary, content, content_sha256, created_by)
    values (app.current_tenant(), $1, $2, $3, 'Draft', $4, $5, $6, $7)`, [d.id, nv, kind, summary, JSON.stringify(cur.content), sha256(cur.content), me.id]);
  await db.query(`update app.documents set state = 'Draft', author_id = $2 where id = $1`, [d.id, me.id]);
  await audit(db, 'version', 'Document', number, `Started ${kind} version v${nv} of ${number}: ${summary}`, { state: 'Effective' }, { state: 'Draft', version: nv });
  await addTask(db, { kind: 'author', recordType: 'document', recordId: d.id, recordNumber: number, assigneeId: me.id, dueAt: dueIn(7) });
  return { version: nv };
}

// Called when the approval envelope completes.
export async function makeEffective(db: Db, documentId: string, versionId: string): Promise<number> {
  const d = await one<DocRow>(db, 'select * from app.documents where id = $1', [documentId]);
  const v = await one<VersionRow>(db, 'select * from app.document_versions where id = $1', [versionId]);
  await db.query(`update app.document_versions set state = 'Superseded' where document_id = $1 and state = 'Effective' and id <> $2`, [documentId, versionId]);
  await db.query('update app.documents set effective_at = now() where id = $1', [documentId]);
  await setState(db, d, v, 'Effective', `${d.number} v${v.version} is Effective`);
  await closeTasks(db, { recordId: documentId, kinds: ['fyi', 'ds-sign', 'send-approval'] });
  const next = new Date(Date.now() + Math.round(d.periodic_months * 30.4) * 86_400_000);
  await db.query(`insert into app.periodic_reviews (tenant_id, number, document_id, reviewer_id, due_at) values (app.current_tenant(), app.next_number('PR'), $1, $2, $3)`, [documentId, d.owner_id, next]);
  return allocateDocument(db, documentId, 'New version effective', null);
}
