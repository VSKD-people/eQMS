// Route 1: approvals through DocuSign. One envelope per version; every send is numbered by the database against
// the yearly allowance; status comes from DocuSign (Connect notifies, the API then reads the envelope to confirm).
import { createHash, randomUUID } from 'node:crypto';
import { rows, one, maybe, mapSeq, type Db } from '@veqms/db';
import { can, planDocumentEnvelope, planClosureEnvelope, verificationComplete, currentOrder, allowanceState, allowanceYear, mapEnvelopeStatus, mapRecipientStatus, type EnvelopePlan, type Verification } from '@veqms/domain';
import type { DocuSign } from '../integrations/docusign.ts';
import type { Storage } from '../integrations/storage.ts';
import { badRequest, conflict, forbidden, logged, notFound } from '../lib/http.ts';
import { people, person, type Person } from '../lib/people.ts';
import { addTask, audit, automationRan, closeTasks, notify, dueIn } from '../lib/work.ts';
import { assertVisible, docByNumber, currentVersion, makeEffective } from './documents.ts';
import { recordFromEnvelope } from './training.ts';
import { documentPdf, closurePdf, mockCertificate, stampSigned, type SignerLine } from './pdf.ts';

export interface Deps { docusign: DocuSign; storage: Storage }

type EnvRow = { id: string; docusign_envelope_id: string | null; record_type: 'document' | 'capa' | 'quality_event'; record_id: string; record_number: string; document_version_id: string | null;
  version: string | null; subject: string; purpose: string; status: 'sent' | 'completed' | 'declined' | 'voided'; sent_by: string; sent_by_name: string; sent_at: Date; completed_at: Date | null;
  decline_reason: string | null; void_reason: string | null; correction_of: string | null; verification: Verification & { by: string; at: string }; pdf_blob: string; pdf_sha256: string;
  signed_pdf_blob: string | null; signed_pdf_sha256: string | null; certificate_blob: string | null; certificate_sha256: string | null; allowance_year: number | null; send_no: number | null };
type SignerRow = { id: string; user_id: string; name: string; email: string; role_label: string; meaning: 'Authored' | 'Reviewed' | 'Approved'; routing_order: number; docusign_recipient_id: string; status: string; sent_at: Date | null; signed_at: Date | null };

const ENV_SELECT = `select e.*, u.name as sent_by_name, s.allowance_year, s.send_no from app.envelopes e join app.users u on u.id = e.sent_by left join app.docusign_sends s on s.envelope_id = e.id`;
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
// Audit trail names for record types, the same everywhere in the trail.
export const LABEL: Record<EnvRow['record_type'], string> = { document: 'Document', capa: 'CAPA', quality_event: 'Quality event' };
// Hash of the exact bytes stored, so anyone can check a file with sha256sum.
const hashBytes = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export type Source = 'app' | 'connect' | 'poll';

async function signers(db: Db, envelopeId: string): Promise<SignerRow[]> {
  return rows<SignerRow>(db, `select s.*, u.name, u.email from app.envelope_signers s join app.users u on u.id = s.user_id where s.envelope_id = $1 order by s.routing_order, u.name`, [envelopeId]);
}

export async function summary(db: Db, e: EnvRow) {
  const ss = await signers(db, e.id);
  return {
    id: e.id, docusignEnvelopeId: e.docusign_envelope_id, recordType: e.record_type, recordNumber: e.record_number, version: e.version, subject: e.subject, purpose: e.purpose,
    status: e.status, sentBy: { id: e.sent_by, name: e.sent_by_name }, sentAt: iso(e.sent_at), completedAt: iso(e.completed_at), sendNo: e.send_no ?? 0, allowanceYear: e.allowance_year ?? 0,
    signed: ss.filter((s) => s.status === 'signed').length, correctionOf: e.correction_of, reason: e.decline_reason ?? e.void_reason,
    signers: ss.map((s) => ({ userId: s.user_id, name: s.name, roleLabel: s.role_label, meaning: s.meaning, routingOrder: s.routing_order, status: s.status, signedAt: iso(s.signed_at) }))
  };
}
export async function byId(db: Db, id: string): Promise<EnvRow> {
  const e = await maybe<EnvRow>(db, ENV_SELECT + ' where e.id = $1', [id]);
  if (!e) throw notFound('That envelope doesn’t exist.');
  return e;
}
export async function latestFor(db: Db, recordId: string) {
  const e = await maybe<EnvRow>(db, ENV_SELECT + ` where e.record_id = $1 order by (e.status = 'sent') desc, e.sent_at desc limit 1`, [recordId]);
  return e ? summary(db, e) : null;
}
// Restricted and confidential documents stay hidden in envelope views and downloads too.
async function assertRecordVisible(db: Db, me: Person, e: EnvRow): Promise<void> {
  if (e.record_type === 'document') await assertVisible(db, me, await docByNumber(db, e.record_number));
}
export async function detail(db: Db, me: Person, id: string) {
  const e = await byId(db, id);
  await assertRecordVisible(db, me, e);
  const events = await rows<{ at: Date; type: string; user_id: string | null; name: string | null; detail: string | null; source: string }>(db,
    'select v.at, v.type, v.user_id, u.name, v.detail, v.source from app.envelope_events v left join app.users u on u.id = v.user_id where v.envelope_id = $1 order by v.at, v.id', [id]);
  return { ...(await summary(db, e)), verification: e.verification,
    events: events.map((v) => ({ at: iso(v.at), type: v.type, user: v.user_id ? { id: v.user_id, name: v.name } : null, detail: v.detail, source: v.source })),
    files: { original: { sha256: e.pdf_sha256 }, signed: e.signed_pdf_sha256 ? { sha256: e.signed_pdf_sha256 } : null, certificate: e.certificate_sha256 ? { sha256: e.certificate_sha256 } : null } };
}

export async function allowance(db: Db) {
  const s = await one<{ docusign_allowance: number; allowance_year_start_month: number; allowance_warn_at: number }>(db, 'select docusign_allowance, allowance_year_start_month, allowance_warn_at from app.settings where tenant_id = app.current_tenant()');
  const y = allowanceYear(new Date(), s.allowance_year_start_month);
  const used = (await one<{ n: number }>(db, 'select count(*)::int as n from app.docusign_sends where allowance_year = $1', [y.year])).n;
  return { ...allowanceState(s.docusign_allowance, used, s.allowance_warn_at), year: y.year, from: y.start.toISOString(), to: new Date(y.end.getTime() - 1).toISOString() };
}

export async function list(db: Db, f: { year?: number; status?: string; record?: string }) {
  const es = await rows<EnvRow>(db, ENV_SELECT + ` where ($1::int is null or s.allowance_year = $1) and ($2::text is null or e.status = $2) and ($3::text is null or e.record_number = $3) order by e.sent_at desc`,
    [f.year ?? null, f.status ?? null, f.record ?? null]);
  return mapSeq(es, (e) => summary(db, e));
}
export async function register(db: Db) {
  const es = await rows<EnvRow>(db, ENV_SELECT + ` where e.status = 'completed' order by e.completed_at desc`);
  return mapSeq(es, (e) => summary(db, e));
}

// ---------- Planning ----------
export async function planForDocument(db: Db, number: string, approverIds?: string[]) {
  const d = await docByNumber(db, number);
  const v = await currentVersion(db, d.id);
  const rv = await rows<{ user_id: string }>(db, 'select user_id from app.document_reviewers where document_id = $1', [d.id]);
  const ap = approverIds ?? (await rows<{ user_id: string }>(db, 'select user_id from app.document_approvers where document_id = $1 order by position', [d.id])).map((r) => r.user_id);
  const ps = await people(db, [d.author_id, ...rv.map((r) => r.user_id), ...ap]);
  const get = (id: string) => { const p = ps.find((x) => x.id === id); if (!p) throw badRequest('Unknown person in the signing order.'); return p; };
  const plan = planDocumentEnvelope({ documentNumber: d.number, title: d.title, version: v.version, author: get(d.author_id), reviewers: rv.map((r) => get(r.user_id)), approvers: ap.map(get) });
  return { d, v, plan, people: ps };
}

async function closureTarget(db: Db, kind: 'capa' | 'quality_event', number: string) {
  if (kind === 'capa') {
    const c = await maybe<{ id: string; number: string; title: string; owner_id: string; state: string; effectiveness_result: string | null; effectiveness_verdict: string | null; effectiveness_criteria: string; problem: string; closure_envelope_id: string | null }>(db, 'select * from app.capas where number = $1', [number]);
    if (!c) throw notFound(`${number} doesn’t exist.`);
    return { id: c.id, number: c.number, title: c.title, ownerId: c.owner_id, state: c.state, purpose: 'CAPA closure' as const, hasText: !!c.effectiveness_result,
      lines: [['Problem', c.problem], ['Success criteria', c.effectiveness_criteria], ['Result', c.effectiveness_result ?? ''], ['Verdict', c.effectiveness_verdict ?? '']] as [string, string][] };
  }
  const q = await maybe<{ id: string; number: string; title: string; owner_id: string; state: string; type: string; description: string; assessment: string; closure_justification: string | null }>(db, 'select * from app.quality_events where number = $1', [number]);
  if (!q) throw notFound(`${number} doesn’t exist.`);
  if (q.type !== 'Deviation') throw conflict('Only deviations close through DocuSign. Other events close with an in-app signature.');
  return { id: q.id, number: q.number, title: q.title, ownerId: q.owner_id, state: q.state, purpose: 'Deviation closure' as const, hasText: !!q.closure_justification,
    lines: [['Type', q.type], ['Description', q.description], ['Assessment', q.assessment], ['Justification for closing without a CAPA', q.closure_justification ?? '']] as [string, string][] };
}
export async function planForClosure(db: Db, kind: 'capa' | 'quality_event', number: string, approverId?: string) {
  const t = await closureTarget(db, kind, number);
  let ap = approverId;
  if (!ap) {
    const qa = await maybe<{ id: string }>(db, `select u.id from app.users u join app.user_roles r on r.user_id = u.id where u.status = 'active' and u.id <> $1 and r.role in ('qm', 'approver') order by (r.role = 'qm') desc, u.name limit 1`, [t.ownerId]);
    ap = qa?.id;
  }
  const ps = await people(db, [t.ownerId, ...(ap ? [ap] : [])]);
  const owner = ps.find((p) => p.id === t.ownerId)!;
  const plan = planClosureEnvelope({ recordNumber: t.number, title: t.title, purpose: t.purpose, owner, approver: ps.find((p) => p.id === ap) ?? null, hasClosureText: t.hasText });
  return { t, plan, people: ps };
}

// ---------- Sending ----------
async function checkPlan(db: Db, plan: EnvelopePlan, recordType: EnvRow['record_type'], recordNumber: string): Promise<void> {
  if (!plan.problems.length) return;
  const e = conflict(plan.problems[0]!);
  const sod = plan.problems.find((p) => /segregation of duties|can’t also|can’t approve/.test(p));
  throw sod ? logged(e, { action: 'sod.block', objectType: LABEL[recordType], objectId: recordNumber, summary: 'DocuSign send blocked: ' + sod }) : e;
}
async function assertCanSend(db: Db, me: Person, recordId: string): Promise<void> {
  if (await maybe(db, `select 1 from app.envelopes where record_id = $1 and status = 'sent'`, [recordId])) throw conflict('An envelope for this record is already out for signature.');
  const a = await allowance(db);
  if (a.exhausted) throw conflict(`This year’s allowance of ${a.allowance} DocuSign sends is used up. Talk to the Quality Manager before sending more.`);
  if (!can(me.roles, 'docusign.send')) throw forbidden('Your role can’t send DocuSign envelopes.');
}

async function dispatch(db: Db, deps: Deps, me: Person, o: { recordType: EnvRow['record_type']; recordId: string; recordNumber: string; versionId: string | null; version: string | null;
  plan: EnvelopePlan; pdf: Uint8Array; fileName: string; verification: Verification; ps: Person[] }) {
  await checkPlan(db, o.plan, o.recordType, o.recordNumber);
  if (!verificationComplete(o.verification)) throw badRequest('Tick all four verification checks (footer, version, document ID, dates) before sending.');
  const id = randomUUID();
  const last = await maybe<{ id: string; status: string }>(db, 'select id, status from app.envelopes where record_id = $1 order by sent_at desc limit 1', [o.recordId]);
  const correctionOf = last && ['voided', 'declined'].includes(last.status) ? last.id : null;
  const pdfKey = `envelopes/${id}/original.pdf`;
  await deps.storage.put(pdfKey, o.pdf, 'application/pdf');
  const pdfSha = hashBytes(o.pdf);
  const verification = { footer: true, version: true, documentId: true, dates: true, note: o.verification.note ?? '', by: me.id, at: new Date().toISOString() };
  await db.query(`insert into app.envelopes (id, tenant_id, record_type, record_id, record_number, document_version_id, version, subject, purpose, sent_by, verification, pdf_blob, pdf_sha256, correction_of)
    values ($1, app.current_tenant(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [id, o.recordType, o.recordId, o.recordNumber, o.versionId, o.version, o.plan.subject, o.plan.purpose, me.id, JSON.stringify(verification), pdfKey, pdfSha, correctionOf]);
  // The database numbers the send and refuses it if the allowance is used up (P0002).
  const send = await one<{ send_no: number; allowance_year: number }>(db, `insert into app.docusign_sends (tenant_id, allowance_year, send_no, envelope_id, sent_by) values (app.current_tenant(), 0, 0, $1, $2) returning send_no, allowance_year`, [id, me.id]);
  const lines = o.plan.signers.map((s, i) => ({ ...s, recipientId: String(i + 1), anchor: `\\s${i + 1}\\`, person: o.ps.find((p) => p.id === s.userId)! }));
  for (const s of lines) {
    await db.query(`insert into app.envelope_signers (tenant_id, envelope_id, user_id, role_label, meaning, routing_order, docusign_recipient_id) values (app.current_tenant(), $1, $2, $3, $4, $5, $6)`,
      [id, s.userId, s.roleLabel, s.meaning, s.routingOrder, s.recipientId]);
  }
  const first = Math.min(...lines.map((s) => s.routingOrder));
  for (const s of lines.filter((x) => x.routingOrder > first)) {
    await addTask(db, { kind: 'fyi', fyi: true, recordType: o.recordType, recordId: o.recordId, recordNumber: o.recordNumber, assigneeId: s.userId, ref: id,
      note: `You’re signer ${s.routingOrder} as ${s.roleLabel}. DocuSign will email you when it’s your turn.` });
  }
  await audit(db, 'docusign.verify', LABEL[o.recordType], o.recordNumber, `Verification check passed for ${o.plan.subject.split(' · ')[0]}: footer, version, document ID and dates`, null, verification);
  // Call DocuSign last: if it fails, the transaction rolls back and no send is counted.
  const dsId = await deps.docusign.createEnvelope({ subject: o.plan.subject, pdf: o.pdf, fileName: o.fileName, veqmsEnvelopeId: id,
    signers: lines.map((s) => ({ recipientId: s.recipientId, name: s.person.name, email: s.person.email, routingOrder: s.routingOrder, meaning: s.meaning, anchor: s.anchor })) });
  await db.query('update app.envelopes set docusign_envelope_id = $2 where id = $1', [id, dsId]);
  await db.query('insert into app.envelope_directory (docusign_envelope_id, tenant_id, envelope_id) values ($1, app.current_tenant(), $2)', [dsId, id]);
  await db.query(`insert into app.envelope_events (tenant_id, envelope_id, type, user_id, detail) values (app.current_tenant(), $1, 'sent', $2, $3)`, [id, me.id, `Envelope sent to ${lines.length} signers${correctionOf ? ' (correction send)' : ''}`]);
  await audit(db, 'docusign.send', LABEL[o.recordType], o.recordNumber, `Sent DocuSign envelope ${dsId} (send ${send.send_no} of the ${send.allowance_year} allowance${correctionOf ? '; correction after a ' + last!.status + ' envelope' : ''})`, null,
    { envelope: id, docusignEnvelopeId: dsId, subject: o.plan.subject, signers: lines.map((s) => `${s.person.name} · ${s.meaning}`), sendNo: send.send_no });
  await advance(db, id);
  const a = await allowance(db);
  if (a.low) {
    const qms = await rows<{ id: string }>(db, `select u.id from app.users u join app.user_roles r on r.user_id = u.id and r.role = 'qm' where u.status = 'active'`);
    await notify(db, { to: qms.map((q) => q.id), kind: 'warn', title: `DocuSign allowance running low: ${a.remaining} sends left this year`, body: `Used ${a.used} of ${a.allowance}.`, href: '/approvals' });
  }
  return summary(db, await byId(db, id));
}

export async function sendDocument(db: Db, deps: Deps, me: Person, number: string, body: { verification: Verification; approvers: string[] }) {
  const { d, v, plan, people: ps } = await planForDocument(db, number, body.approvers);
  await assertVisible(db, me, d);
  if (d.state !== 'Review closed') throw conflict('Only a document in Review closed can be sent for approval.');
  await checkPlan(db, plan, 'document', d.number);
  if (![d.owner_id, d.author_id].includes(me.id) && !me.roles.includes('qm')) throw forbidden('Only the owner, the author or a Quality Manager can send this envelope.');
  await assertCanSend(db, me, d.id);
  const owner = await person(db, d.owner_id);
  const signerLines: SignerLine[] = plan.signers.map((s, i) => ({ name: ps.find((p) => p.id === s.userId)!.name, roleLabel: s.roleLabel, meaning: s.meaning, anchor: `\\s${i + 1}\\` }));
  const pdf = await documentPdf({ number: d.number, title: d.title, version: v.version, classification: d.classification, owner: owner?.name ?? '', generatedAt: new Date(), blocks: v.content, signers: signerLines });
  await db.query('delete from app.document_approvers where document_id = $1', [d.id]);
  for (const [i, a] of body.approvers.entries()) await db.query(`insert into app.document_approvers (tenant_id, document_id, user_id, position) values (app.current_tenant(), $1, $2, $3)`, [d.id, a, i + 1]);
  const env = await dispatch(db, deps, me, { recordType: 'document', recordId: d.id, recordNumber: d.number, versionId: v.id, version: v.version, plan, pdf, fileName: `${d.number}_v${v.version}.pdf`, verification: body.verification, ps });
  await db.query(`update app.documents set state = 'In approval', approval_due = $2 where id = $1`, [d.id, dueIn(5)]);
  await db.query(`update app.document_versions set state = 'In approval', envelope_id = $2 where id = $1`, [v.id, env.id]);
  await audit(db, 'state', 'Document', d.number, `Sent v${v.version} to DocuSign for approval`, { state: 'Review closed' }, { state: 'In approval' });
  await closeTasks(db, { recordId: d.id, kinds: ['send-approval'] });
  return env;
}

export async function sendClosure(db: Db, deps: Deps, me: Person, kind: 'capa' | 'quality_event', number: string, body: { verification: Verification; approverId?: string }) {
  const { t, plan, people: ps } = await planForClosure(db, kind, number, body.approverId);
  await checkPlan(db, plan, kind, t.number);
  if (kind === 'capa' && t.state !== 'Effectiveness check') throw conflict('A CAPA goes to DocuSign when its effectiveness check is recorded.');
  if (kind === 'quality_event' && !['Open', 'Assessment'].includes(t.state)) throw conflict('This deviation isn’t open.');
  if (t.ownerId !== me.id && !me.roles.includes('qm')) throw forbidden('Only the owner or a Quality Manager can send the closure.');
  await assertCanSend(db, me, t.id);
  const signerLines: SignerLine[] = plan.signers.map((s, i) => ({ name: ps.find((p) => p.id === s.userId)!.name, roleLabel: s.roleLabel, meaning: s.meaning, anchor: `\\s${i + 1}\\` }));
  const pdf = await closurePdf({ number: t.number, title: t.title, purpose: t.purpose, owner: ps.find((p) => p.id === t.ownerId)!.name, lines: t.lines, signers: signerLines, generatedAt: new Date() });
  const env = await dispatch(db, deps, me, { recordType: kind, recordId: t.id, recordNumber: t.number, versionId: null, version: null, plan, pdf, fileName: `${t.number}_closure.pdf`, verification: body.verification, ps });
  await db.query(`update app.${kind === 'capa' ? 'capas' : 'quality_events'} set closure_envelope_id = $2 where id = $1`, [t.id, env.id]);
  await closeTasks(db, { recordId: t.id, kinds: ['effectiveness', 'qe-assess'] });
  return env;
}

// Deliver to the next routing order when everyone in the current one has signed; complete when nobody is left.
async function advance(db: Db, envelopeId: string): Promise<void> {
  const e = await byId(db, envelopeId);
  const ss = await signers(db, envelopeId);
  const cur = currentOrder(ss.map((s) => ({ routingOrder: s.routing_order, status: s.status })));
  if (cur === null) return;
  for (const s of ss.filter((x) => x.routing_order === cur && x.status === 'waiting')) {
    await db.query(`update app.envelope_signers set status = 'sent', sent_at = now() where id = $1`, [s.id]);
    await db.query(`insert into app.envelope_events (tenant_id, envelope_id, type, user_id, detail) values (app.current_tenant(), $1, 'delivered', $2, 'DocuSign emailed the signing link')`, [envelopeId, s.user_id]);
    if (e.record_type === 'document' && s.meaning === 'Approved') await db.query(`update app.document_approvers set status = 'Your turn' where document_id = $1 and user_id = $2`, [e.record_id, s.user_id]);
    await closeTasks(db, { recordId: e.record_id, kinds: ['fyi'], assigneeId: s.user_id });
    await addTask(db, { kind: 'ds-sign', recordType: e.record_type, recordId: e.record_id, recordNumber: e.record_number, assigneeId: s.user_id, dueAt: dueIn(5), ref: envelopeId, note: `${s.role_label} · meaning: ${s.meaning} · use the link in your DocuSign email` });
    await notify(db, { to: [s.user_id], kind: 'action', mandatory: true, title: `Your turn to sign ${e.subject.split(' · ')[0]} in DocuSign`, body: 'DocuSign has emailed you the signing link.', recordType: e.record_type, recordId: e.record_id });
  }
}

// ---------- Status from DocuSign ----------
export interface SignerUpdate { recipientId: string; status: 'sent' | 'delivered' | 'signed' | 'declined'; at: string | null; declinedReason?: string | null }

export async function applyStatus(db: Db, deps: Deps, envelopeId: string, envStatus: 'sent' | 'completed' | 'declined' | 'voided', updates: SignerUpdate[], voidedReason: string | null, source: Source): Promise<void> {
  const e = await byId(db, envelopeId);
  if (e.status !== 'sent') return; // already final: ignore repeats (Connect retries are expected)
  const ss = await signers(db, envelopeId);
  for (const u of updates) {
    const s = ss.find((x) => x.docusign_recipient_id === u.recipientId);
    if (!s || s.status === u.status || s.status === 'signed') continue;
    if (u.status === 'signed') {
      await db.query(`update app.envelope_signers set status = 'signed', signed_at = coalesce($2::timestamptz, now()) where id = $1`, [s.id, u.at]);
      await db.query(`insert into app.envelope_events (tenant_id, envelope_id, type, user_id, source) values (app.current_tenant(), $1, 'signed', $2, $3)`, [envelopeId, s.user_id, source]);
      await audit(db, 'docusign.signed', LABEL[e.record_type], e.record_number, `DocuSign: ${s.name} signed ${e.subject.split(' · ')[0]} · ${s.meaning}`, null, { envelope: envelopeId, signer: s.name, meaning: s.meaning, at: u.at });
      await closeTasks(db, { recordId: e.record_id, kinds: ['ds-sign'], assigneeId: s.user_id });
      if (e.record_type === 'document' && s.meaning === 'Approved') await db.query(`update app.document_approvers set status = 'Signed', signed_at = now() where document_id = $1 and user_id = $2`, [e.record_id, s.user_id]);
    } else if (u.status === 'declined') {
      await db.query(`update app.envelope_signers set status = 'declined' where id = $1`, [s.id]);
      await decline(db, e, s.user_id, u.declinedReason || 'No reason given in DocuSign', source);
      return;
    } else if (u.status === 'delivered' && s.status === 'sent') {
      await db.query(`update app.envelope_signers set status = 'delivered' where id = $1`, [s.id]);
    }
  }
  if (envStatus === 'voided') { await giveBack(db, e, 'voided', voidedReason || 'Voided in DocuSign', null, source); return; }
  if (envStatus === 'declined') { await decline(db, e, null, 'Declined in DocuSign', source); return; }
  const left = (await signers(db, envelopeId)).some((s) => s.status !== 'signed');
  if (!left || envStatus === 'completed') await complete(db, deps, envelopeId, source);
  else await advance(db, envelopeId);
}

export async function fromDocuSign(db: Db, deps: Deps, envelopeId: string, source: 'connect' | 'poll'): Promise<void> {
  const e = await byId(db, envelopeId);
  if (!e.docusign_envelope_id) return;
  const st = await deps.docusign.getStatus(e.docusign_envelope_id);
  if (!st) return;
  const envStatus = mapEnvelopeStatus(st.status);
  if (!envStatus) return;
  const updates: SignerUpdate[] = [];
  for (const r of st.recipients) { const s = mapRecipientStatus(r.status); if (s) updates.push({ recipientId: r.recipientId, status: s, at: r.signedAt, declinedReason: r.declinedReason }); }
  await applyStatus(db, deps, envelopeId, envStatus, updates, st.voidedReason, source);
}

async function complete(db: Db, deps: Deps, envelopeId: string, source: Source): Promise<void> {
  const e = await byId(db, envelopeId);
  const ss = await signers(db, envelopeId);
  let signed = e.docusign_envelope_id ? await deps.docusign.downloadSigned(e.docusign_envelope_id) : null;
  let cert = e.docusign_envelope_id ? await deps.docusign.downloadCertificate(e.docusign_envelope_id) : null;
  if (!signed || !cert) { // mock mode: generate stand-ins
    const original = await deps.storage.get(e.pdf_blob);
    signed = await stampSigned(original, ss.map((s) => `${s.role_label}: ${s.name} · ${s.meaning} · ${iso(s.signed_at)}`));
    cert = await mockCertificate([['Envelope', e.docusign_envelope_id ?? e.id], ['Subject', e.subject], ['Sent', iso(e.sent_at) ?? ''], ...ss.map((s) => [s.name, `${s.meaning} · ${iso(s.signed_at)}`] as [string, string])]);
  }
  const signedKey = `envelopes/${e.id}/signed.pdf`, certKey = `envelopes/${e.id}/certificate.pdf`;
  await deps.storage.put(signedKey, signed, 'application/pdf');
  await deps.storage.put(certKey, cert, 'application/pdf');
  const signedSha = hashBytes(signed), certSha = hashBytes(cert);
  await db.query(`update app.envelopes set status = 'completed', completed_at = now(), signed_pdf_blob = $2, signed_pdf_sha256 = $3, certificate_blob = $4, certificate_sha256 = $5 where id = $1`,
    [e.id, signedKey, signedSha, certKey, certSha]);
  await db.query(`insert into app.envelope_events (tenant_id, envelope_id, type, detail, source) values (app.current_tenant(), $1, 'completed', 'Envelope completed. Signed PDF and certificate of completion downloaded and stored.', $2)`, [e.id, source]);
  for (const s of ss) {
    await db.query(`insert into app.signatures (tenant_id, record_type, record_id, record_number, document_version_id, user_id, meaning, signed_at, source, envelope_id, content_sha256, statement)
      values (app.current_tenant(), $1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), 'docusign', $8, $9, $10)`,
      [e.record_type, e.record_id, e.record_number, e.document_version_id, s.user_id, s.meaning, s.signed_at, e.id, e.pdf_sha256,
       `Signed in DocuSign with the Part 11 module: signer re-authenticated and chose the meaning “${s.meaning}”.`]);
  }
  await audit(db, 'docusign.completed', LABEL[e.record_type], e.record_number, `Envelope ${e.docusign_envelope_id} completed; signed PDF, certificate of completion and envelope ID stored`, null,
    { envelope: e.id, docusignEnvelopeId: e.docusign_envelope_id, signedPdfSha256: signedSha, certificateSha256: certSha });
  let training = 0;
  if (e.record_type === 'document' && e.document_version_id) {
    await db.query('update app.document_versions set approved_at = now(), envelope_id = $2 where id = $1', [e.document_version_id, e.id]);
    training = await recordFromEnvelope(db, e.record_id, e.version!, e.id, ss.map((s) => ({ userId: s.user_id, meaning: s.meaning })));
    await makeEffective(db, e.record_id, e.document_version_id);
  } else if (e.record_type === 'capa') {
    await db.query(`update app.capas set state = 'Closed', closed_at = now() where id = $1`, [e.record_id]);
    await audit(db, 'state', 'CAPA', e.record_number, `${e.record_number} closed: closure approved through DocuSign`, { state: 'Effectiveness check' }, { state: 'Closed' });
    // The event that raised the CAPA closes with it. Every state change is audited, this one included.
    const c = await one<{ source_event_id: string | null }>(db, 'select source_event_id from app.capas where id = $1', [e.record_id]);
    const src = c.source_event_id ? await maybe<{ number: string; state: string }>(db, 'select number, state from app.quality_events where id = $1', [c.source_event_id]) : null;
    if (c.source_event_id && src && src.state !== 'Closed') {
      await db.query(`update app.quality_events set state = 'Closed', closed_at = now() where id = $1`, [c.source_event_id]);
      await audit(db, 'state', 'Quality event', src.number, `${src.number} closed: its CAPA ${e.record_number} closed through DocuSign`, { state: src.state }, { state: 'Closed' });
    }
  } else {
    const prev = await one<{ state: string }>(db, 'select state from app.quality_events where id = $1', [e.record_id]);
    await db.query(`update app.quality_events set state = 'Closed', closed_at = now() where id = $1`, [e.record_id]);
    await audit(db, 'state', 'Quality event', e.record_number, `${e.record_number} closed without a CAPA: approved through DocuSign`, { state: prev.state }, { state: 'Closed' });
  }
  await closeTasks(db, { recordId: e.record_id, kinds: ['ds-sign', 'fyi'] });
  await notify(db, { to: [e.sent_by], kind: 'info', title: `DocuSign envelope completed: ${e.subject.split(' · ')[0]}`, body: 'Signed PDF and certificate of completion are stored against the record.', recordType: e.record_type, recordId: e.record_id });
  await automationRan(db, 'RULE-15', e.record_type, e.record_id, 'Done', `Envelope completed${training ? `; ${training} completed training records for author and reviewers` : ''}`);
}

async function decline(db: Db, e: EnvRow, userId: string | null, reason: string, source: Source): Promise<void> {
  await db.query(`update app.envelopes set status = 'declined', declined_by = $2, decline_reason = $3 where id = $1`, [e.id, userId, reason]);
  await db.query(`insert into app.envelope_events (tenant_id, envelope_id, type, user_id, detail, source) values (app.current_tenant(), $1, 'declined', $2, $3, $4)`, [e.id, userId, reason, source]);
  await giveBack(db, e, 'declined', reason, userId, source, true);
}

// Declined or voided: the record goes back with the reason recorded. A corrected envelope is a new send.
async function giveBack(db: Db, e: EnvRow, how: 'declined' | 'voided', reason: string, by: string | null, source: Source, alreadyMarked = false): Promise<void> {
  if (how === 'voided' && !alreadyMarked) {
    await db.query(`update app.envelopes set status = 'voided', voided_by = $2, void_reason = $3 where id = $1`, [e.id, by, reason]);
    await db.query(`insert into app.envelope_events (tenant_id, envelope_id, type, user_id, detail, source) values (app.current_tenant(), $1, 'voided', $2, $3, $4)`, [e.id, by, reason, source]);
  }
  await db.query(`update app.envelope_signers set status = 'voided' where envelope_id = $1 and status not in ('signed', 'declined')`, [e.id]);
  await audit(db, `docusign.${how === 'voided' ? 'void' : 'declined'}`, LABEL[e.record_type], e.record_number, `Envelope ${how}: ${reason}. A corrected envelope is a new send.`, { status: 'sent' }, { status: how, reason });
  await closeTasks(db, { recordId: e.record_id, kinds: ['ds-sign', 'fyi'] });
  const why = `Envelope ${how}${by ? ' by ' + ((await person(db, by))?.name ?? 'a signer') : ''}. Reason: ${reason}`;
  if (e.record_type === 'document') {
    const d = await one<{ id: string; number: string; author_id: string; owner_id: string }>(db, 'select id, number, author_id, owner_id from app.documents where id = $1', [e.record_id]);
    await db.query(`update app.document_approvers set status = 'Waiting', signed_at = null where document_id = $1`, [d.id]);
    await db.query(`update app.document_reviewers set status = 'Not started', reviewed_at = null where document_id = $1`, [d.id]);
    await db.query(`update app.documents set state = 'Draft' where id = $1`, [d.id]);
    if (e.document_version_id) await db.query(`update app.document_versions set state = 'Draft' where id = $1`, [e.document_version_id]);
    await audit(db, 'state', 'Document', d.number, 'Returned to draft: ' + why, { state: 'In approval' }, { state: 'Draft' });
    await addTask(db, { kind: 'resubmit', recordType: 'document', recordId: d.id, recordNumber: d.number, assigneeId: d.author_id, dueAt: dueIn(5), note: why });
    await notify(db, { to: [d.author_id, d.owner_id], kind: 'warn', title: `${d.number} returned to draft`, body: why, recordType: 'document', recordId: d.id, href: `/documents/${d.number}` });
  } else {
    const table = e.record_type === 'capa' ? 'capas' : 'quality_events';
    const r = await one<{ owner_id: string }>(db, `update app.${table} set closure_envelope_id = null where id = $1 returning owner_id`, [e.record_id]);
    await addTask(db, { kind: e.record_type === 'capa' ? 'effectiveness' : 'qe-assess', recordType: e.record_type, recordId: e.record_id, recordNumber: e.record_number, assigneeId: r.owner_id, dueAt: dueIn(3), note: why });
    await notify(db, { to: [r.owner_id], kind: 'warn', title: `${e.record_number} closure ${how}`, body: why, recordType: e.record_type, recordId: e.record_id });
  }
}

export async function voidEnvelope(db: Db, deps: Deps, me: Person, envelopeId: string, reason: string) {
  const e = await byId(db, envelopeId);
  if (e.status !== 'sent') throw conflict(`This envelope is ${e.status}.`);
  const owner = await maybe<{ owner_id: string }>(db, `select owner_id from app.documents where id = $1 union all select owner_id from app.capas where id = $1 union all select owner_id from app.quality_events where id = $1`, [e.record_id]);
  if (e.sent_by !== me.id && owner?.owner_id !== me.id && !me.roles.includes('qm')) throw forbidden('Only the sender, the record owner or a Quality Manager can void this envelope.');
  if (e.docusign_envelope_id) await deps.docusign.voidEnvelope(e.docusign_envelope_id, reason);
  await giveBack(db, e, 'voided', reason, me.id, 'app');
  return summary(db, await byId(db, envelopeId));
}

// Development and UAT only (DOCUSIGN_MODE=mock): stands in for the signer acting in DocuSign.
export async function mockAct(db: Db, deps: Deps, me: Person, envelopeId: string, action: 'sign' | 'decline', reason?: string) {
  if (deps.docusign.mode !== 'mock') throw forbidden('Only available with the DocuSign mock.');
  const e = await byId(db, envelopeId);
  if (e.status !== 'sent') throw conflict(`This envelope is ${e.status}.`);
  const ss = await signers(db, envelopeId);
  const s = ss.find((x) => x.user_id === me.id && (x.status === 'sent' || x.status === 'delivered'));
  if (!s) throw conflict('It isn’t your turn to sign this envelope.');
  await applyStatus(db, deps, envelopeId, 'sent', [{ recipientId: s.docusign_recipient_id, status: action === 'sign' ? 'signed' : 'declined', at: new Date().toISOString(), declinedReason: reason ?? null }], null, 'app');
  return summary(db, await byId(db, envelopeId));
}

export async function file(db: Db, deps: Deps, me: Person, envelopeId: string, kind: 'original' | 'signed' | 'certificate') {
  const e = await byId(db, envelopeId);
  await assertRecordVisible(db, me, e);
  const key = kind === 'original' ? e.pdf_blob : kind === 'signed' ? e.signed_pdf_blob : e.certificate_blob;
  if (!key) throw notFound('That file is stored when the envelope completes.');
  await audit(db, 'read', LABEL[e.record_type], e.record_number, `Opened ${kind} PDF of envelope ${e.docusign_envelope_id ?? e.id}`);
  return { bytes: await deps.storage.get(key), name: `${e.record_number}${e.version ? '_v' + e.version : ''}_${kind}.pdf` };
}

// Evidence that a Connect message arrived: its hash is kept with the envelope's events.
export async function connectReceived(db: Db, envelopeId: string, payloadSha256: string, dsStatus: string): Promise<void> {
  await db.query(`insert into app.envelope_events (tenant_id, envelope_id, type, detail, source, payload_sha256) values (app.current_tenant(), $1, 'status-check', $2, 'connect', $3)`,
    [envelopeId, `Connect message received (DocuSign status: ${dsStatus || 'unknown'}). Status confirmed with the DocuSign API.`, payloadSha256]);
}

// Envelopes still out after this many hours are checked against DocuSign by the scheduled job, in case a Connect message was missed.
export async function staleEnvelopes(db: Db, hours: number): Promise<string[]> {
  return (await rows<{ id: string }>(db, `select id from app.envelopes where status = 'sent' and docusign_envelope_id is not null and sent_at < now() - make_interval(hours => $1)`, [hours])).map((r) => r.id);
}
