// Route 2: read-and-understood training. The database enforces the locks (see 003_training.sql); this service
// decides who gets what, and when.
import { rows, maybe, one, type Db } from '@veqms/db';
import { ackStatement, inAudience, trainingStatus, matrixCell, hasAudience, type Audience, type Role, type TrainingStatus } from '@veqms/domain';
import { badRequest, forbidden, conflict } from '../lib/http.ts';
import { people, type Person } from '../lib/people.ts';
import { addTask, closeTasks, notify, audit, automationRan, dueIn } from '../lib/work.ts';

export interface RecordRow {
  id: string; user_id: string; user_name: string; document_id: string; document_number: string; title: string; version: string;
  allocated_by: string | null; allocated_by_name: string | null; alloc_reason: string; assigned_at: Date; due_at: Date | null; completed_at: Date | null;
  statement: string | null; quiz_result: string | null; via: string | null; envelope_id: string | null; correction_of: string | null;
  correction_reason: string | null; no_retrain: boolean; closed_at: Date | null; closed_reason: string | null; effective_version: string | null; corrected: boolean;
}

const RECORD_SELECT = `
  select r.*, u.name as user_name, a.name as allocated_by_name,
    (select v.version from app.document_versions v where v.document_id = r.document_id and v.state = 'Effective' limit 1) as effective_version,
    exists (select 1 from app.training_records c where c.correction_of = r.id) as corrected
  from app.training_records r join app.users u on u.id = r.user_id left join app.users a on a.id = r.allocated_by`;

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

export function status(r: RecordRow, now = new Date()): TrainingStatus {
  return trainingStatus({ id: r.id, userId: r.user_id, documentId: r.document_id, version: r.version, dueAt: iso(r.due_at), completedAt: iso(r.completed_at), closedAt: iso(r.closed_at), correctionOf: r.correction_of, noRetrain: r.no_retrain },
    { now, effectiveVersion: r.effective_version, correctedIds: new Set(r.corrected ? [r.id] : []) });
}

export function toApi(r: RecordRow) {
  return {
    id: r.id, user: { id: r.user_id, name: r.user_name }, documentId: r.document_id, documentNumber: r.document_number, title: r.title, version: r.version,
    allocatedBy: r.allocated_by ? { id: r.allocated_by, name: r.allocated_by_name ?? '' } : null, allocReason: r.alloc_reason,
    assignedAt: iso(r.assigned_at), dueAt: iso(r.due_at), completedAt: iso(r.completed_at), statement: r.statement, quizResult: r.quiz_result, via: r.via,
    envelopeId: r.envelope_id, correctionOf: r.correction_of, correctionReason: r.correction_reason, noRetrain: r.no_retrain,
    closedAt: iso(r.closed_at), closedReason: r.closed_reason, status: status(r)
  };
}

export async function audienceOf(db: Db, documentId: string): Promise<Audience & { userRefs: { id: string; name: string }[] }> {
  const d = await one<{ training_days: number; training_quiz: boolean }>(db, 'select training_days, training_quiz from app.documents where id = $1', [documentId]);
  const groups = await rows<{ name: string }>(db, 'select g.name from app.audience_groups a join app.groups g on g.id = a.group_id where a.document_id = $1 order by g.name', [documentId]);
  const roles = await rows<{ role: Role }>(db, 'select role from app.audience_roles where document_id = $1 order by role', [documentId]);
  const users = await rows<{ id: string; name: string }>(db, 'select u.id, u.name from app.audience_users a join app.users u on u.id = a.user_id where a.document_id = $1 order by u.name', [documentId]);
  return { groups: groups.map((g) => g.name), roles: roles.map((r) => r.role), users: users.map((u) => u.id), userRefs: users, daysToComplete: d.training_days, quiz: d.training_quiz };
}

async function effective(db: Db, documentId: string) {
  return maybe<{ id: string; number: string; title: string; version: string }>(db,
    `select d.id, d.number, d.title, v.version from app.documents d join app.document_versions v on v.document_id = d.id and v.state = 'Effective' where d.id = $1`, [documentId]);
}

async function allocate(db: Db, doc: { id: string; number: string; title: string; version: string }, userId: string, reason: string, by: string | null, days: number): Promise<boolean> {
  const r = await rows<{ id: string; due_at: Date }>(db, `
    insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, allocated_by, alloc_reason, due_at)
    values (app.current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)
    on conflict (user_id, document_id, version) where closed_at is null and correction_of is null do nothing
    returning id, due_at`, [userId, doc.id, doc.number, doc.title, doc.version, by, reason, dueIn(days)]);
  const rec = r[0];
  if (!rec) return false;
  await addTask(db, { kind: 'training', recordType: 'document', recordId: doc.id, recordNumber: doc.number, assigneeId: userId, dueAt: rec.due_at, ref: rec.id });
  await notify(db, { to: [userId], kind: 'action', title: `New training: ${doc.number} ${doc.title} v${doc.version}`, body: reason, recordType: 'document', recordId: doc.id, href: `/training/${rec.id}` });
  return true;
}

async function closeOpen(db: Db, where: string, params: unknown[], reason: string): Promise<number> {
  const closed = await rows<{ id: string; user_id: string; document_id: string }>(db,
    `update app.training_records set closed_at = now(), closed_reason = $${params.length + 1}
     where completed_at is null and closed_at is null and not no_retrain and ${where} returning id, user_id, document_id`, [...params, reason]);
  for (const c of closed) await closeTasks(db, { recordId: c.document_id, kinds: ['training'], assigneeId: c.user_id, ref: c.id });
  return closed.length;
}

// A new version became effective: earlier open allocations close as superseded, then the whole audience is allocated.
export async function allocateDocument(db: Db, documentId: string, reason: string, by: string | null): Promise<number> {
  const doc = await effective(db, documentId);
  if (!doc) return 0;
  await closeOpen(db, 'document_id = $1 and version <> $2', [documentId, doc.version], `Superseded by v${doc.version}`);
  const aud = await audienceOf(db, documentId);
  let n = 0;
  for (const p of await people(db)) if (inAudience(aud, p) && (await allocate(db, doc, p.id, reason, by, aud.daysToComplete))) n++;
  await automationRan(db, 'RULE-09', 'document', documentId, 'Done', n ? `Allocated v${doc.version} to ${n} people; earlier records kept as superseded` : hasAudience(aud) ? 'Everyone in the audience already has a record' : 'No training audience');
  return n;
}

// New starters, group moves and role changes: allocate what the audience now needs, close what no longer applies.
export async function reconcileUser(db: Db, userId: string, reason: string): Promise<{ added: number; closed: number }> {
  const [p] = await people(db, [userId]);
  if (!p) return { added: 0, closed: 0 };
  let added = 0, closed = 0;
  const docs = await rows<{ id: string }>(db, `select distinct document_id as id from app.document_versions where state = 'Effective'`);
  for (const d of docs) {
    const aud = await audienceOf(db, d.id);
    if (inAudience(aud, p)) {
      const doc = await effective(db, d.id);
      if (doc && (await allocate(db, doc, userId, reason, null, aud.daysToComplete))) added++;
    } else {
      closed += await closeOpen(db, 'user_id = $1 and document_id = $2 and correction_of is null', [userId, d.id], `${reason}: no longer in the audience`);
    }
  }
  return { added, closed };
}

// Approval envelope completed: the author and each reviewer get a completed record for that version.
export async function recordFromEnvelope(db: Db, documentId: string, version: string, envelopeId: string, signers: { userId: string; meaning: string }[]): Promise<number> {
  const d = await one<{ number: string; title: string }>(db, 'select number, title from app.documents where id = $1', [documentId]);
  let n = 0;
  const seen = new Set<string>();
  for (const s of signers.filter((x) => x.meaning === 'Authored' || x.meaning === 'Reviewed')) {
    if (seen.has(s.userId)) continue; seen.add(s.userId);
    const r = await rows(db, `insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, alloc_reason, envelope_id, statement)
      values (app.current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8)
      on conflict (user_id, document_id, version) where closed_at is null and correction_of is null do nothing returning id`,
      [s.userId, documentId, d.number, d.title, version, `Approval envelope (${s.meaning.toLowerCase()})`, envelopeId,
       `Signed ${d.number}, version ${version} in DocuSign with the meaning “${s.meaning}” (envelope ${envelopeId})`]);
    if (r.length) n++;
  }
  return n;
}

export async function getRecord(db: Db, id: string): Promise<RecordRow> {
  return one<RecordRow>(db, RECORD_SELECT + ' where r.id = $1', [id]);
}

export async function listRecords(db: Db, f: { userId?: string; documentNumber?: string; status?: string; all?: boolean }) {
  const list = await rows<RecordRow>(db, RECORD_SELECT + ` where ($1::uuid is null or r.user_id = $1) and ($2::text is null or r.document_number = $2) order by r.assigned_at desc`,
    [f.userId ?? null, f.documentNumber ?? null]);
  return list.map(toApi).filter((r) => (f.all || !['Superseded', 'Withdrawn', 'Corrected', 'Correction', 'Obsolete'].includes(r.status)) && (!f.status || r.status === f.status));
}

export async function quiz(db: Db, documentId: string) {
  return rows<{ position: number; question: string; options: string[]; answer_index: number }>(db,
    'select position, question, options, answer_index from app.quiz_questions where document_id = $1 and active order by position', [documentId]);
}

export async function complete(db: Db, me: Person, via: string, id: string, quizAnswers: number[] | undefined) {
  const r = await getRecord(db, id);
  if (r.user_id !== me.id) throw forbidden(`Only ${r.user_name} can confirm this record.`);
  if (!['Assigned', 'Overdue'].includes(status(r))) throw conflict('This record isn’t open.');
  const d = await one<{ training_quiz: boolean }>(db, 'select training_quiz from app.documents where id = $1', [r.document_id]);
  let quizResult: string | null = null;
  if (d.training_quiz) {
    const qs = await quiz(db, r.document_id);
    if (qs.length) {
      if (!quizAnswers || quizAnswers.length !== qs.length) throw badRequest(`Answer all ${qs.length} questions.`);
      const wrong = qs.map((q, i) => (quizAnswers[i] === q.answer_index ? 0 : i + 1)).filter(Boolean);
      if (wrong.length) throw badRequest(`Not quite: check question ${wrong.join(', ')} against the document.`);
      quizResult = `${qs.length}/${qs.length}`;
    }
  }
  const s = await one<{ ack_statement: string }>(db, 'select ack_statement from app.settings where tenant_id = app.current_tenant()');
  await db.query('update app.training_records set completed_at = now(), statement = $2, quiz_result = $3, via = $4 where id = $1',
    [id, ackStatement(s.ack_statement, r.document_number, r.version), quizResult, via]);
  await closeTasks(db, { recordId: r.document_id, kinds: ['training'], assigneeId: me.id });
  return toApi(await getRecord(db, id));
}

export async function correct(db: Db, me: Person, id: string, reason: string, retrain: boolean) {
  const r = await getRecord(db, id);
  if (!r.completed_at) throw conflict('Only a completed record can be corrected; close an open one instead.');
  if (r.corrected) throw conflict('This record has already been corrected.');
  const days = (await audienceOf(db, r.document_id)).daysToComplete;
  const c = await one<{ id: string; due_at: Date | null }>(db, `insert into app.training_records (tenant_id, user_id, document_id, document_number, title, version, allocated_by, alloc_reason, due_at, correction_of, correction_reason, no_retrain)
    values (app.current_tenant(), $1, $2, $3, $4, $5, $6, 'Correction', $7, $8, $9, $10) returning id, due_at`,
    [r.user_id, r.document_id, r.document_number, r.title, r.version, me.id, retrain ? dueIn(days) : null, r.id, reason, !retrain]);
  if (retrain) {
    await addTask(db, { kind: 'training', recordType: 'document', recordId: r.document_id, recordNumber: r.document_number, assigneeId: r.user_id, dueAt: c.due_at, ref: c.id });
    await notify(db, { to: [r.user_id], kind: 'action', title: `Please retrain: ${r.document_number} v${r.version}`, body: reason, recordType: 'document', recordId: r.document_id, href: `/training/${c.id}` });
  }
  return toApi(await getRecord(db, c.id));
}

export async function setAudience(db: Db, me: Person, documentId: string, a: { groups: string[]; roles: Role[]; users: string[]; daysToComplete: number; quiz: boolean }) {
  const before = await audienceOf(db, documentId);
  const groups = await rows<{ id: string }>(db, 'select id from app.groups where name = any($1::text[])', [a.groups]);
  if (groups.length !== new Set(a.groups).size) throw badRequest('One of the groups doesn’t exist.');
  const users = await rows<{ id: string }>(db, "select id from app.users where id = any($1::uuid[]) and status = 'active'", [a.users]);
  if (users.length !== new Set(a.users).size) throw badRequest('One of the people isn’t an active user.');
  await db.query('delete from app.audience_groups where document_id = $1', [documentId]);
  await db.query('delete from app.audience_roles where document_id = $1', [documentId]);
  await db.query('delete from app.audience_users where document_id = $1', [documentId]);
  for (const g of groups) await db.query('insert into app.audience_groups (tenant_id, document_id, group_id) values (app.current_tenant(), $1, $2)', [documentId, g.id]);
  for (const r of new Set(a.roles)) await db.query('insert into app.audience_roles (tenant_id, document_id, role) values (app.current_tenant(), $1, $2)', [documentId, r]);
  for (const u of users) await db.query('insert into app.audience_users (tenant_id, document_id, user_id) values (app.current_tenant(), $1, $2)', [documentId, u.id]);
  await db.query('update app.documents set training_days = $2, training_quiz = $3 where id = $1', [documentId, a.daysToComplete, a.quiz]);
  const after = await audienceOf(db, documentId);
  const d = await one<{ number: string }>(db, 'select number from app.documents where id = $1', [documentId]);
  const show = (x: Audience) => ({ groups: x.groups, roles: x.roles, users: x.users, daysToComplete: x.daysToComplete, quiz: x.quiz });
  await audit(db, 'training.audience', 'Document', d.number, `Changed the training audience of ${d.number}`, { audience: show(before) }, { audience: show(after) });
  let added = 0, closed = 0;
  const doc = await effective(db, documentId);
  if (doc) {
    const everyone = await people(db);
    for (const p of everyone) if (inAudience(after, p) && (await allocate(db, doc, p.id, 'Audience change', me.id, after.daysToComplete))) added++;
    const out = everyone.filter((p) => !inAudience(after, p)).map((p) => p.id);
    if (out.length) closed = await closeOpen(db, 'document_id = $1 and user_id = any($2::uuid[]) and correction_of is null', [documentId, out], 'Audience change: no longer in the audience');
  }
  return { added, closed };
}

export async function matrix(db: Db, group?: string) {
  const docs = await rows<{ id: string; number: string; title: string; version: string }>(db,
    `select d.id, d.number, d.title, v.version from app.documents d join app.document_versions v on v.document_id = d.id and v.state = 'Effective' order by d.number`);
  const everyone = (await people(db)).filter((p) => p.status === 'active' && !p.roles.includes('auditor') && (!group || p.groups.includes(group)));
  const all = await rows<RecordRow>(db, RECORD_SELECT);
  const withStatus = all.map((r) => ({ ...toApi(r), userId: r.user_id, assignedAt: iso(r.assigned_at)! }));
  const cells: Record<string, Record<string, ReturnType<typeof matrixCell>>> = {};
  const shown: typeof docs = [];
  for (const d of docs) {
    const aud = await audienceOf(db, d.id);
    const recs = withStatus.filter((r) => r.documentId === d.id);
    if (!hasAudience(aud) && !recs.length) continue;
    shown.push(d);
    for (const p of everyone) (cells[p.id] ??= {})[d.id] = matrixCell(p, aud, d.version, recs);
  }
  return { documents: shown.map((d) => ({ id: d.id, number: d.number, title: d.title, currentVersion: d.version })), people: everyone.map((p) => ({ id: p.id, name: p.name, jobTitle: p.jobTitle })), cells };
}

export async function reminders(db: Db): Promise<{ sent: number; overdue: number }> {
  // Runs once a day. Reminders go out on the days in settings.reminder_days (days before due); overdue notices go
  // out the day after the due date and then every overdue_repeat_days, with the manager copied.
  const s = await one<{ reminder_days: number[]; overdue_repeat_days: number }>(db, 'select reminder_days, overdue_repeat_days from app.settings where tenant_id = app.current_tenant()');
  const repeat = Math.max(1, s.overdue_repeat_days);
  const open = (await rows<RecordRow>(db, RECORD_SELECT + ' where r.completed_at is null and r.closed_at is null and not r.no_retrain')).filter((r) => ['Assigned', 'Overdue'].includes(status(r)));
  let sent = 0, overdue = 0;
  for (const r of open) {
    if (!r.due_at) continue;
    const days = Math.ceil((new Date(r.due_at).getTime() - Date.now()) / 86_400_000);
    if (days < 0 && (-days - 1) % repeat === 0) {
      const mgr = await maybe<{ manager_id: string | null }>(db, 'select manager_id from app.users where id = $1', [r.user_id]);
      await notify(db, { to: [r.user_id, mgr?.manager_id ?? ''], kind: 'overdue', mandatory: true, title: `Overdue: ${r.document_number} v${r.version} training for ${r.user_name}`, recordType: 'document', recordId: r.document_id, href: `/training/${r.id}` });
      overdue++;
    } else if (days >= 0 && s.reminder_days.includes(days)) {
      await notify(db, { to: [r.user_id], kind: 'reminder', title: `Reminder: ${r.document_number} v${r.version} training is due in ${days} day${days === 1 ? '' : 's'}`, recordType: 'document', recordId: r.document_id, href: `/training/${r.id}` });
      sent++;
    }
  }
  await audit(db, 'training.reminders', 'Training', 'REMINDERS', `Sent ${sent} reminders and ${overdue} overdue notices (managers copied on overdue)`, null, { reminders: sent, overdue });
  await automationRan(db, 'RULE-16', null, null, 'Sent', `${sent} reminders, ${overdue} overdue`);
  return { sent, overdue };
}
