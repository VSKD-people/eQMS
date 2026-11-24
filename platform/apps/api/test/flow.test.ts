// End-to-end run of the API services against a freshly seeded database, as the veqms_app role (row-level
// security, grants and database rules all apply). It changes data: CI migrates and seeds a scratch database just
// before it (see .github/workflows/platform-ci.yml). Skipped when DATABASE_URL is not set.
// Covers Route 1 (Adobe Sign approvals: send, sign in order, complete, cancel, decline, correction send, closures,
// webhook-style status sync) and Route 2 (allocation, confirmation, quiz, locks, corrections), plus admin and email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, withTenant, rows, one, type Db } from '@veqms/db';
import { personByOid, people } from '../src/lib/people.ts';
import * as signing from '../src/services/agreements.ts';
import * as docs from '../src/services/documents.ts';
import * as training from '../src/services/training.ts';
import * as closures from '../src/routes/closures.ts';
import * as admin from '../src/routes/admin.ts';
import { createAdobeSign } from '../src/integrations/adobesign.ts';
import { sendQueuedEmail } from '../src/integrations/mail.ts';
import { HttpError } from '../src/lib/http.ts';
import { anchor, checkLatest } from '../src/services/anchor.ts';

test('API flow: Adobe Sign approvals, training records, closures, admin', { skip: process.env.DATABASE_URL ? false : 'set DATABASE_URL to a freshly seeded database' }, async () => {
  // Act as the API's database role, whatever login the test connects with. The role is set when each connection
  // starts (PostgreSQL's `-c role=` startup option), so no query runs ahead of the test's own.
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c role=veqms_app');
  const pool = createPool({ connectionString: url.toString() });
  const tenantId = (await pool.query('select tenant_id from app.tenant_directory where entra_tenant_id = $1', ['dev-tenant'])).rows[0].tenant_id;
  // The test changes data, so it needs a freshly seeded database. Say so plainly rather than fail halfway through.
  const fresh = (await withTenant(pool, { tenantId, userId: null }, (db) => rows<{ state: string }>(db, "select state from app.documents where number = 'VP-001'")))[0];
  assert.equal(fresh?.state, 'Review closed', 'This test needs a freshly migrated and seeded database (npm run db:migrate && npm run db:seed on an empty database).');
  const files = new Map<string, Buffer>();
  const storage = { put: async (k: string, b: Uint8Array) => { if (files.has(k)) throw new Error('exists ' + k); files.set(k, Buffer.from(b)); }, get: async (k: string) => files.get(k)! };
  const deps = { esign: createAdobeSign({ ADOBE_SIGN_MODE: 'mock' } as any), storage };
  const ids: Record<string, string> = {};
  for (const k of ['vic', 'sam', 'priya', 'tom', 'grace', 'daniel', 'hannah', 'aud', 'omar', 'mia', 'lena', 'jake']) {
    ids[k] = (await withTenant(pool, { tenantId, userId: null }, (db) => personByOid(db, 'dev-' + k)))!.id;
  }
  const as = <T>(who: string, fn: (db: Db, me: any) => Promise<T>): Promise<T> =>
    withTenant(pool, { tenantId, userId: ids[who]! }, async (db) => fn(db, await personByOid(db, 'dev-' + who)));
  const sys = <T>(fn: (db: Db) => Promise<T>) => withTenant(pool, { tenantId, userId: null }, fn);
  const V = { footer: true, version: true, documentId: true, dates: true } as const;
  let checks = 0;
  const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; console.log('  ✓ ' + msg); };
  async function fails(p: Promise<unknown>, re: RegExp, msg: string, status?: number) {
    try { await p; } catch (e: any) { assert.match(String(e.message), re, msg + ' (got: ' + e.message + ')'); if (status) assert.equal(e.status ?? (e.code === 'P0001' ? 409 : undefined), status); checks++; console.log('  ✓ ' + msg); return e; }
    assert.fail(msg + ': expected an error');
  }
  const docState = (n: string) => sys((db) => one<{ state: string }>(db, 'select state from app.documents where number = $1', [n])).then((r) => r.state);
  async function signAll(envId: string, order: string[]) {
    for (const who of order) await as(who, (db, me) => signing.mockAct(db, deps, me, envId, 'sign'));
  }

  console.log('Allowance and planning');
  const a0 = await as('vic', (db) => signing.allowance(db));
  const base = a0.used;
  ok(a0.allowance === 500 && a0.year === new Date().getUTCFullYear(), `allowance: ${base} of 500 used in ${a0.year}`);
  const plan3 = await as('vic', (db) => signing.planForDocument(db, 'POL-003'));
  ok(plan3.plan.problems.some((p: string) => /segregation of duties/.test(p)), 'POL-003: Victoria wrote it, so the plan shows a segregation-of-duties problem');
  const sodLog = () => sys((db) => rows<{ summary: string }>(db, `select summary from app.audit_log where action = 'sod.block' and object_id = 'POL-003' order by seq`));
  await as('vic', (db) => signing.logBlockedPlan(db, plan3.plan, 'document', 'POL-003'));
  ok((await sodLog()).some((r) => /^Send page shown with sending blocked/.test(r.summary)), 'showing the blocked plan is in the audit trail');
  const planVp = await as('vic', (db) => signing.planForDocument(db, 'VP-001'));
  const before = (await sys((db) => one<{ n: number }>(db, `select count(*)::int as n from app.audit_log where action = 'sod.block'`))).n;
  await as('vic', (db) => signing.logBlockedPlan(db, planVp.plan, 'document', 'VP-001'));
  ok((await sys((db) => one<{ n: number }>(db, `select count(*)::int as n from app.audit_log where action = 'sod.block'`))).n === before, 'a plan without a segregation-of-duties problem logs nothing');
  const sod = await fails(as('vic', (db, me) => signing.sendDocument(db, deps, me, 'POL-003', { verification: V, approvers: [ids.vic!, ids.tom!] })), /segregation of duties/, 'POL-003 send blocked (SoD)');
  ok(sod instanceof HttpError && sod.log?.action === 'sod.block', 'the SoD refusal carries an audit note for the error handler');
  await fails(as('vic', (db, me) => signing.sendDocument(db, deps, me, 'VP-001', { verification: { ...V, dates: false } as any, approvers: [ids.vic!] })), /verification/, 'send refused until all four verification checks are ticked');
  await fails(as('daniel', (db, me) => signing.sendDocument(db, deps, me, 'VP-001', { verification: V, approvers: [ids.vic!] })), /owner|role/, 'an employee cannot send');

  console.log('Route 1: VP-001 sent, signed in order, completed');
  const e1 = await as('vic', (db, me) => signing.sendDocument(db, deps, me, 'VP-001', { verification: V, approvers: [ids.vic!] }));
  ok(e1.transactionNo === base + 1 && e1.allowanceYear === a0.year && e1.status === 'sent', `one send counted: send ${e1.transactionNo} of ${a0.year}`);
  ok(e1.signers.map((s: any) => `${s.meaning}:${s.routingOrder}:${s.status}`).join(',') === 'Authored:1:sent,Reviewed:2:waiting,Approved:3:waiting', 'signing order: author, reviewer, QA approver; only the author has it');
  ok(await docState('VP-001') === 'In approval', 'VP-001 is In approval');
  const t1 = await sys((db) => rows(db, `select kind, assignee_id from app.tasks where record_number = 'VP-001' and status = 'open' order by kind`));
  ok(t1.some((t: any) => t.kind === 'esign' && t.assignee_id === ids.priya) && t1.filter((t: any) => t.kind === 'fyi').length === 2, 'tasks: author signs now; reviewer and approver get FYIs');
  await fails(as('vic', (db, me) => signing.mockAct(db, deps, me, e1.id, 'sign')), /isn’t your turn/, 'QA approver cannot sign before the author and reviewer');
  await fails(as('vic', (db, me) => signing.sendDocument(db, deps, me, 'VP-001', { verification: V, approvers: [ids.vic!] })), /Review closed|already out/, 'no second agreement while one is out');
  await as('priya', (db, me) => signing.mockAct(db, deps, me, e1.id, 'sign'));
  const mid = await as('vic', (db, me) => signing.detail(db, me, e1.id));
  ok(mid.signers.find((s: any) => s.meaning === 'Reviewed')?.status === 'sent' && mid.signed === 1, 'after the author signs, the reviewer is up');
  await signAll(e1.id, ['omar', 'vic']);
  const d1 = await as('vic', (db, me) => signing.detail(db, me, e1.id));
  ok(d1.status === 'completed' && d1.files.signed && d1.files.auditReport, 'agreement completed; signed PDF and audit report stored with hashes');
  ok(await docState('VP-001') === 'Effective', 'VP-001 is Effective');
  const sig1 = await sys((db) => rows(db, `select meaning, source from app.signatures where record_number = 'VP-001' order by meaning`));
  ok(sig1.length === 3 && sig1.every((s: any) => s.source === 'adobe'), '3 signatures recorded from Adobe Sign');
  const tr1 = await sys((db) => rows<any>(db, `select r.user_id, r.completed_at, r.agreement_id, r.alloc_reason from app.training_records r where r.document_number = 'VP-001'`));
  ok(tr1.some((r) => r.user_id === ids.priya && r.completed_at && r.agreement_id === e1.id) && tr1.some((r) => r.user_id === ids.omar && r.completed_at), 'author and reviewer get completed training records from the agreement');
  ok(tr1.some((r) => r.user_id === ids.jake && !r.completed_at), 'the IT team audience is allocated the new version');
  ok(!tr1.some((r) => r.user_id === ids.priya && !r.completed_at), 'the author is not asked to read what they signed');
  const f = await as('vic', (db, me) => signing.file(db, deps, me, e1.id, 'signed'));
  ok(f.bytes.length > 0 && f.name === 'VP-001_v1.0_signed.pdf', 'signed PDF downloads');
  await fails(sys((db) => db.query(`update app.agreements set subject = 'x' where id = $1`, [e1.id])), /completed and cannot change/, 'a completed agreement is locked in the database');
  const pr = await sys((db) => rows(db, `select 1 from app.periodic_reviews where document_id = (select id from app.documents where number = 'VP-001')`));
  ok(pr.length === 1, 'periodic review scheduled');

  console.log('Route 1: POL-004 cancelled, corrected, resent, declined');
  const e4 = await sys((db) => one<{ id: string }>(db, `select id from app.agreements where record_number = 'POL-004' and status = 'sent'`));
  await fails(as('daniel', (db, me) => signing.cancelAgreement(db, deps, me, e4.id, 'Wrong date in the footer')), /sender|owner/, 'an employee cannot cancel');
  await as('sam', (db, me) => signing.cancelAgreement(db, deps, me, e4.id, 'Wrong date in the footer'));
  ok(await docState('POL-004') === 'Draft', 'cancelled: POL-004 back to Draft');
  const v4 = await as('sam', (db, me) => signing.detail(db, me, e4.id));
  ok(v4.status === 'cancelled' && v4.reason === 'Wrong date in the footer' && v4.signers.filter((s: any) => s.status === 'cancelled').length === 2, 'cancel reason kept; unsigned signers voided');
  await as('sam', (db, me) => docs.submit(db, me, 'POL-004', [ids.priya!], [ids.vic!, ids.tom!]));
  ok(await docState('POL-004') === 'In review', 'resubmitted for review');
  await fails(as('omar', (db, me) => docs.review(db, me, 'POL-004')), /pending reviewer/, 'only a named reviewer can review');
  await as('priya', (db, me) => docs.review(db, me, 'POL-004', 'Fine'));
  ok(await docState('POL-004') === 'Review closed', 'last reviewer closes the review');
  const e5 = await as('sam', (db, me) => signing.sendDocument(db, deps, me, 'POL-004', { verification: V, approvers: [ids.vic!, ids.tom!] }));
  ok(e5.correctionOf === e4.id && e5.transactionNo === base + 2, 'correction send: linked to the cancelled agreement, counted as a new transaction');
  await as('sam', (db, me) => signing.mockAct(db, deps, me, e5.id, 'sign'));
  await as('priya', (db, me) => signing.mockAct(db, deps, me, e5.id, 'decline', 'Section 3 contradicts SOP-018'));
  const d5 = await as('sam', (db, me) => signing.detail(db, me, e5.id));
  ok(d5.status === 'declined' && /SOP-018/.test(d5.reason ?? ''), 'declined with the reason recorded');
  ok(await docState('POL-004') === 'Draft', 'declined: POL-004 back to Draft');
  const rs = await sys((db) => rows(db, `select note from app.tasks where record_number = 'POL-004' and kind = 'resubmit' and status = 'open'`));
  ok(rs.length === 1 && /SOP-018/.test((rs[0] as any).note), 'author has a resubmit task with the reason');

  console.log('Route 1: new document from draft to Effective');
  const groups = await sys((db) => rows<{ name: string }>(db, 'select name from app.groups order by name'));
  const nd = await as('sam', (db, me) => docs.create(db, me, { docType: 'Procedure', title: 'Firewall Change Procedure', classification: 'Internal', ownerId: ids.sam!, process: 'ISMS · Network',
    audience: { groups: ['Support team'], roles: [], users: [ids.lena!], daysToComplete: 10, quiz: false } }));
  ok(/^SOP-\d+$/.test(nd.number), `numbered ${nd.number}`);
  const noAudience = { groups: [], roles: [], users: [], daysToComplete: 14, quiz: false };
  const uar = await as('vic', (db, me) => docs.create(db, me, { docType: 'User access review', title: 'Q4 access review: finance systems', classification: 'Confidential', ownerId: ids.vic!, process: 'ISMS · Access control', audience: noAudience }));
  const ra = await as('vic', (db, me) => docs.create(db, me, { docType: 'Risk assessment', title: 'Cloud backup provider risk assessment', classification: 'Confidential', ownerId: ids.vic!, process: 'ISMS · Risk', audience: noAudience }));
  ok(uar.number === 'UAR-001' && ra.number === 'RA-001', `new document types: ${uar.number} and ${ra.number}, approved through Adobe Sign like any controlled document`);
  await as('sam', (db, me) => docs.saveDraft(db, me, nd.number, [{ t: 'h', x: '1. Purpose' }, { t: 'p', x: 'Control firewall changes.' }], 'First draft'));
  await as('sam', (db, me) => docs.submit(db, me, nd.number, [], [ids.tom!]));
  ok(await docState(nd.number) === 'Review closed', 'no reviewers: straight to Review closed');
  const e6 = await as('sam', (db, me) => signing.sendDocument(db, deps, me, nd.number, { verification: V, approvers: [ids.tom!] }));
  await signAll(e6.id, ['sam', 'tom']);
  ok(await docState(nd.number) === 'Effective', `${nd.number} Effective`);
  const tr6 = await sys((db) => rows<any>(db, `select user_id from app.training_records where document_number = $1 and completed_at is null`, [nd.number]));
  ok(tr6.some((r) => r.user_id === ids.daniel) && tr6.some((r) => r.user_id === ids.lena) && !tr6.some((r) => r.user_id === ids.jake), 'audience (Support team + Lena) allocated; others not');
  const nv = await as('sam', (db, me) => docs.newVersion(db, me, nd.number, 'minor', 'Typo fix'));
  ok(nv.version === '0.2', 'new minor version 0.2 started from the effective 0.1');

  console.log('Route 2: read and understood');
  const open = await as('daniel', (db) => training.listRecords(db, { userId: ids.daniel }));
  const sop12 = open.find((r: any) => r.documentNumber === 'SOP-012' && (r.status === 'Assigned' || r.status === 'Overdue'));
  ok(!!sop12, 'Daniel has SOP-012 to read');
  await fails(as('lena', (db, me) => training.complete(db, me, 'Development sign-in', sop12!.id, undefined)), /Only Daniel/, 'only the trainee can confirm');
  const qa = await sys((db) => training.quiz(db, sop12!.documentId));
  await fails(as('daniel', (db, me) => training.complete(db, me, 'Development sign-in', sop12!.id, qa.map((q: any) => q.answer_index))), /Open the PDF of SOP-012 v3\.0 first/, 'cannot confirm before opening the PDF of the version');
  await as('daniel', async (db) => { const d = await docs.docByNumber(db, 'SOP-012'); await docs.logPdfOpen(db, d, await docs.currentVersion(db, d.id)); });
  ok(await as('daniel', (db, me) => training.pdfOpened(db, me.id, { document_id: sop12!.documentId, document_number: 'SOP-012', version: sop12!.version, assigned_at: new Date(sop12!.assignedAt) })), 'opening the PDF is logged with its version');
  await fails(as('daniel', (db, me) => training.complete(db, me, 'Development sign-in', sop12!.id, [0, 0, 0])), /check question/, 'wrong quiz answers are refused');
  const done = await as('daniel', (db, me) => training.complete(db, me, 'Development sign-in', sop12!.id, qa.map((q: any) => q.answer_index)));
  ok(done.status === 'Complete' && /read and understood SOP-012, version 3.0/.test(done.statement ?? '') && done.quizResult === '3/3', 'confirmed with the statement and quiz result');
  await fails(as('daniel', (db, me) => training.complete(db, me, 'Development sign-in', sop12!.id, qa.map((q: any) => q.answer_index))), /isn’t open/, 'cannot confirm twice');
  await fails(sys((db) => db.query(`update app.training_records set completed_at = now() - interval '9 days' where id = $1`, [sop12!.id])), /locked|cannot/, 'database refuses to edit a completed record');
  await fails(sys((db) => db.query(`delete from app.training_records where id = $1`, [sop12!.id])), /permission denied|cannot/, 'database refuses to delete a record');
  const corr = await as('vic', (db, me) => training.correct(db, me, sop12!.id, 'Confirmed on the wrong account during a shared-screen session', true));
  ok(corr.correctionOf === sop12!.id && corr.status === 'Assigned', 'QM correction is a new record and asks for retraining');
  const orig = await sys((db) => training.getRecord(db, sop12!.id));
  ok(training.toApi(orig).status === 'Corrected' && !!orig.completed_at, 'original record kept, marked Corrected');
  const m = await as('vic', (db) => training.matrix(db));
  ok(m.documents.length >= 5 && m.cells[ids.daniel!] !== undefined, `matrix: ${m.documents.length} documents x ${m.people.length} people`);
  const rem = await sys((db) => training.reminders(db));
  ok(typeof rem.sent === 'number' && typeof rem.overdue === 'number', `reminders ran: ${rem.sent} reminders, ${rem.overdue} overdue`);

  console.log('Closures through Adobe Sign');
  const cp = await as('priya', (db) => signing.planForClosure(db, 'capa', 'CAPA-005', ids.vic));
  ok(cp.plan.problems.includes('Record the effectiveness result first.'), 'CAPA closure blocked until the result is recorded');
  await as('priya', (db, me) => closures.recordEffectiveness(db, me, 'CAPA-005', 'Click rate in November simulation was 4%.', 'Effective'));
  const ce = await as('priya', (db, me) => signing.sendClosure(db, deps, me, 'capa', 'CAPA-005', { verification: V, approverId: ids.vic! }));
  await fails(as('priya', (db, me) => closures.recordEffectiveness(db, me, 'CAPA-005', 'Changed my mind about this.', 'Effective')), /out for signature/, 'result locked while the closure is out for signature');
  await signAll(ce.id, ['priya', 'vic']);
  const capa = await sys((db) => one<any>(db, `select c.state, q.state as qe from app.capas c join app.quality_events q on q.id = c.source_event_id where c.number = 'CAPA-005'`));
  ok(capa.state === 'Closed' && capa.qe === 'Closed', 'CAPA-005 closed, and its source event QE-013');
  const qeAudit = await sys((db) => rows<{ before: { state: string } | null }>(db, `select before from app.audit_log where object_type = 'Quality event' and object_id = 'QE-013' and action = 'state'`));
  ok(qeAudit.length === 1 && qeAudit[0]!.before?.state === 'CAPA raised', 'QE-013 closing is in the audit trail with its previous state');
  await fails(as('grace', (db, me) => signing.sendClosure(db, deps, me, 'quality_event', 'QE-017', { verification: V, approverId: ids.vic! })), /justification/, 'deviation closure needs a justification');
  await as('grace', (db, me) => closures.recordClosureJustification(db, me, 'QE-017', 'One-off delay; the test passed and the schedule stays the same.'));
  await fails(as('grace', (db, me) => signing.sendClosure(db, deps, me, 'quality_event', 'QE-017', { verification: V, approverId: ids.grace! })), /owns this record/, 'owner cannot approve their own closure');
  const qe1 = await as('grace', (db, me) => signing.sendClosure(db, deps, me, 'quality_event', 'QE-017', { verification: V, approverId: ids.vic! }));
  await as('grace', (db, me) => signing.mockAct(db, deps, me, qe1.id, 'sign'));
  await as('vic', (db, me) => signing.mockAct(db, deps, me, qe1.id, 'decline', 'Add the date the test actually ran'));
  const back = await sys((db) => one<any>(db, `select state, closure_agreement_id from app.quality_events where number = 'QE-017'`));
  ok(back.state === 'Assessment' && back.closure_agreement_id === null, 'declined closure goes back to the owner');
  const qe2 = await as('grace', (db, me) => signing.sendClosure(db, deps, me, 'quality_event', 'QE-017', { verification: V, approverId: ids.vic! }));
  ok(qe2.correctionOf === qe1.id, 'second closure agreement is a correction send');
  await signAll(qe2.id, ['grace', 'vic']);
  ok((await sys((db) => one<any>(db, `select state from app.quality_events where number = 'QE-017'`))).state === 'Closed', 'QE-017 closed');

  console.log('Status from Adobe Sign (webhook path, live client faked)');
  let agState: any = null;
  const sent: any[] = [];
  const live = { mode: 'live' as const, createAgreement: async (a: any) => { sent.push(a); return 'adobe-fake-' + sent.length; }, cancelAgreement: async () => {}, getState: async () => agState,
    downloadSigned: async () => new Uint8Array(Buffer.from('%PDF-signed')), downloadAuditReport: async () => new Uint8Array(Buffer.from('%PDF-audit')), checkSignIn: async () => {} };
  const ldeps = { esign: live, storage };
  const emailOf = async (k: string) => (await sys((db) => one<{ e: string }>(db, 'select lower(email) as e from app.users where id = $1', [ids[k]]))).e;
  const samEmail = await emailOf('sam'), vicEmail = await emailOf('vic');
  await as('sam', (db, me) => docs.submit(db, me, nd.number, [], [ids.vic!]));
  const e7 = await as('sam', (db, me) => signing.sendDocument(db, ldeps, me, nd.number, { verification: V, approvers: [ids.vic!] }));
  ok(sent[0]?.participants.map((p: any) => `${p.email}:${p.order}`).join(',') === `${samEmail}:1,${vicEmail}:2`, 'Adobe Sign gets one participant per signer, in order, by email');
  const dir = await pool.query('select agreement_id from app.agreement_directory where provider_agreement_id = $1', ['adobe-fake-1']);
  ok(dir.rows[0]?.agreement_id === e7.id, 'agreement directory maps the Adobe Sign ID to the agreement (for webhooks)');
  agState = { status: 'OUT_FOR_SIGNATURE', cancelComment: null, outcomes: [{ email: samEmail, outcome: 'signed', at: new Date().toISOString(), comment: null }] };
  await sys(async (db) => { await signing.webhookReceived(db, e7.id, 'abc', 'AGREEMENT_ACTION_COMPLETED'); await signing.fromProvider(db, ldeps, e7.id, 'webhook'); });
  await sys((db) => signing.fromProvider(db, ldeps, e7.id, 'webhook'));
  const s7 = await as('sam', (db, me) => signing.detail(db, me, e7.id));
  ok(s7.signed === 1 && s7.signers[1]?.status === 'sent' && s7.events.filter((x: any) => x.type === 'signed').length === 1, 'webhook: author signed, approver up; a repeat notification changes nothing');
  agState = { status: 'SIGNED', cancelComment: null, outcomes: [{ email: samEmail, outcome: 'signed', at: new Date().toISOString(), comment: null }, { email: vicEmail, outcome: 'signed', at: new Date().toISOString(), comment: null }] };
  await sys((db) => signing.fromProvider(db, ldeps, e7.id, 'poll'));
  const c7 = await as('sam', (db, me) => signing.detail(db, me, e7.id));
  ok(c7.status === 'completed' && (await docState(nd.number)) === 'Effective', 'completed from Adobe Sign status; v0.2 Effective');
  const sup = await sys((db) => rows<any>(db, `select r.closed_reason from app.training_records r where r.document_number = $1 and r.version = '0.1' and r.completed_at is null and r.closed_at is not null`, [nd.number]));
  ok(sup.length > 0, 'open v0.1 allocations closed when v0.2 became effective');
  // Adobe Sign reports a signer's rejection as CANCELLED; the REJECTED event makes it a decline, not a cancellation.
  const tomEmail = await emailOf('tom');
  const e8 = await as('vic', (db, me) => signing.sendDocument(db, ldeps, me, 'POL-003', { verification: V, approvers: [ids.tom!] }));
  agState = { status: 'CANCELLED', cancelComment: null, outcomes: [{ email: vicEmail, outcome: 'signed', at: new Date().toISOString(), comment: null }, { email: tomEmail, outcome: 'declined', at: new Date().toISOString(), comment: 'Section 3 contradicts the handling standard.' }] };
  await sys((db) => signing.fromProvider(db, ldeps, e8.id, 'webhook'));
  const d8 = await as('vic', (db, me) => signing.detail(db, me, e8.id));
  ok(d8.status === 'declined' && d8.reason === 'Section 3 contradicts the handling standard.' && (await docState('POL-003')) === 'Draft', 'rejected in Adobe Sign (reported as CANCELLED): declined with the signer’s reason; POL-003 back to Draft');

  console.log('Admin, email, register, audit');
  await as('hannah', async (db) => admin.setStatus(db, (await people(db, [ids.jake!]))[0]!, 'left', 'Left the company'));
  const jake = await sys((db) => one<any>(db, `select status, sessions_revoked_at, (select count(*)::int from app.training_records where user_id = $1 and completed_at is null and closed_at is null) as open from app.users where id = $1`, [ids.jake]));
  ok(jake.status === 'left' && jake.sessions_revoked_at && jake.open === 0, 'leaver: sessions revoked, open training closed, records kept');
  await as('hannah', (db) => db.query('delete from app.user_roles where user_id = $1 and role = $2', [ids.mia, 'author']));
  ok(true, 'the API role can remove a role assignment');
  const mail = await sendQueuedEmail(pool, { GRAPH_MAIL_FROM: '', APP_BASE_URL: 'http://x' } as any, tenantId);
  const mail2 = await sendQueuedEmail(pool, { GRAPH_MAIL_FROM: '', APP_BASE_URL: 'http://x' } as any, tenantId);
  ok(mail.skipped > 0 && mail2.skipped === 0, `email not configured: ${mail.skipped} queued emails logged as skipped, once`);
  const reg = await as('vic', (db) => signing.register(db));
  ok(reg.length >= 7 && reg.every((r: any) => r.status === 'completed'), `approvals register: ${reg.length} completed agreements`);
  const log = await as('vic', (db) => signing.list(db, { record: 'POL-004' }));
  ok(log.length === 2 && log.map((e: any) => e.status).sort().join() === 'cancelled,declined', 'transactions log for POL-004: the cancelled seeded agreement and the declined correction');
  const a1 = await as('vic', (db) => signing.allowance(db));
  ok(a1.used === base + 8, `allowance used: ${a1.used} (${base} seeded + 8 transactions in this run)`);
  await sys((db) => db.query('update app.settings set signing_allowance = $1 where tenant_id = app.current_tenant()', [a1.used]));
  await as('sam', (db, me) => docs.submit(db, me, 'POL-004', [], [ids.vic!]));
  await fails(as('sam', (db, me) => signing.sendDocument(db, deps, me, 'POL-004', { verification: V, approvers: [ids.vic!] })), /Adobe Sign transactions is used up/, 'send refused when the allowance of transactions is used up');
  const chain = await sys((db) => one<any>(db, 'select * from app.verify_audit_chain()'));
  ok(chain.ok === true, `audit chain intact: ${chain.entries} entries`);
  const a1st = await sys((db) => anchor(db, storage as any));
  ok(!!a1st && a1st.seq === Number(chain.entries), `audit anchor written for entry ${a1st?.seq}`);
  ok((await sys((db) => anchor(db, storage as any))) === null, 'no new anchor while the chain has not grown');
  ok((await sys((db) => checkLatest(db, storage as any))).matches === true, 'the latest anchor matches the chain');
  const anchorKey = [...files.keys()].find((k) => k.startsWith('audit-anchors/'))!;
  files.set(anchorKey, Buffer.from(JSON.stringify({ ...a1st, hash: '0'.repeat(64) })));
  const bad = await sys((db) => checkLatest(db, storage as any));
  ok(bad.matches === false && /differs/.test(bad.problem ?? ''), 'a changed anchor file is reported');
  const actions = await sys((db) => rows<any>(db, `select action, count(*)::int as n from app.audit_log group by action order by action`));
  console.log('  audit actions: ' + actions.map((a: any) => `${a.action}=${a.n}`).join(', '));
  console.log(`\n${checks} checks passed`);
  await pool.end();
});
