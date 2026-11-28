// End-to-end run of the API services against a freshly seeded database, as the veqms_app role (row-level
// security, grants and database rules all apply). It changes data: CI migrates and seeds a scratch database just
// before it (see .github/workflows/platform-ci.yml). Skipped when DATABASE_URL is not set.
// Covers Route 1 (the amendment flow: change request, locked PDF and its check at submit, review, approval in VeQMS
// with the retraining decision, the agreement sent on the last approval, signing in order, cancel, decline, returns,
// closures, webhook-style status sync) and Route 2 (allocation, confirmation, quiz, locks, corrections), plus admin
// and email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import * as sp from '../src/services/sharepoint.ts';
import { createSharePoint, DeltaExpired } from '../src/integrations/sharepoint.ts';
import { loadConfig } from '../src/config.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

test('API flow: Adobe Sign approvals, training records, closures, SharePoint, admin', { skip: process.env.DATABASE_URL ? false : 'set DATABASE_URL to a freshly seeded database' }, async () => {
  // Act as the API's database role, whatever login the test connects with. The role is set when each connection
  // starts (PostgreSQL's `-c role=` startup option), so no query runs ahead of the test's own.
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c role=veqms_app');
  const pool = createPool({ connectionString: url.toString() });
  const tenantId = (await pool.query('select tenant_id from app.tenant_directory where entra_tenant_id = $1', ['dev-tenant'])).rows[0].tenant_id;
  // The test changes data, so it needs a freshly seeded database. Say so plainly rather than fail halfway through.
  const fresh = await withTenant(pool, { tenantId, userId: null }, (db) => rows<{ number: string; state: string }>(db, "select number, state from app.documents where number in ('VP-001', 'POL-004') order by number"));
  assert.equal(fresh.map((d) => d.state).join(), 'Signing,Draft', 'This test needs a freshly migrated and seeded database (npm run db:migrate && npm run db:seed on an empty database).');
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
  // The amendment flow's steps, as the API routes call them.
  const sendWith = (dp: any) => (tx: Db, by: any, n: string) => signing.sendApprovedDocument(tx, dp, by, n);
  const makePdf = (who: string, n: string, reviewers: string[], approvers: string[]) => as(who, (db, me) => docs.preparePdf(db, me, storage as any, n, reviewers, approvers));
  async function submitDoc(who: string, n: string, reviewers: string[], approvers: string[]) {
    const { sha256 } = await makePdf(who, n, reviewers, approvers);
    await as(who, (db, me) => docs.submit(db, me, n, V, sha256));
    return sha256;
  }
  const approve = (who: string, n: string, o: { retrain?: boolean; reason?: string } = {}, dp: any = deps) =>
    as(who, (db, me) => docs.approve(db, me, n, { retrain: o.retrain ?? true, reason: o.reason }, sendWith(dp)));
  const sentFor = async (n: string) => {
    const r = await sys((db) => one<{ id: string }>(db, `select id from app.agreements where record_number = $1 order by sent_at desc limit 1`, [n]));
    return as('vic', (db, me) => signing.detail(db, me, r.id));
  };
  const versionOf = (n: string) => sys((db) => one<any>(db, `select v.*, c.number as cr_number, c.state as cr_state from app.document_versions v join app.documents d on d.id = v.document_id
    left join app.change_requests c on c.id = v.change_request_id where d.number = $1 order by v.created_at desc limit 1`, [n]));

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
  const sod = await fails(makePdf('vic', 'POL-003', [ids.priya!], [ids.vic!, ids.tom!]), /segregation of duties/, 'POL-003: submitting with its author as QA approver is refused (SoD)');
  ok(sod instanceof HttpError && sod.log?.action === 'sod.block' && /^Submit refused/.test(sod.log.summary), 'the SoD refusal at submit carries an audit note for the error handler');

  console.log('Route 1: VP-001 submitted (locked PDF, four checks), reviewed, approved, signed in order, Effective');
  ok((await versionOf('VP-001')).cr_number === 'CR-019', 'the amendment started as a change request (CR-019)');
  await fails(as('daniel', (db, me) => docs.preparePdf(db, me, storage as any, 'VP-001', [ids.omar!], [ids.vic!])), /author or owner/, 'only the author or owner can submit');
  await fails(as('priya', (db, me) => docs.submit(db, me, 'VP-001', V, '0'.repeat(64))), /Make the PDF/, 'no submit before the PDF is made');
  const pdf1 = await makePdf('priya', 'VP-001', [ids.omar!], [ids.vic!]);
  const v1 = await versionOf('VP-001');
  ok(v1.pdf_blob && v1.content_sha256 === pdf1.sha256 && createHash('sha256').update(files.get(v1.pdf_blob)!).digest('hex') === pdf1.sha256, 'the draft is converted to PDF, hashed and locked; the version hash is the PDF hash');
  await fails(as('priya', (db, me) => docs.submit(db, me, 'VP-001', { ...V, dates: false } as any, pdf1.sha256)), /four checks/, 'submit refused until all four checks are ticked');
  await fails(as('priya', (db, me) => docs.submit(db, me, 'VP-001', V, 'f'.repeat(64))), /PDF changed/, 'submit refused for a PDF other than the one checked');
  await as('priya', (db, me) => docs.submit(db, me, 'VP-001', V, pdf1.sha256));
  ok(await docState('VP-001') === 'In review' && (await versionOf('VP-001')).verification?.by === ids.priya, 'submitted: In review, with who made the checks');
  await fails(as('priya', (db, me) => docs.saveDraft(db, me, 'VP-001', [{ t: 'p', x: 'Changed' }], 'x')), /Only a draft/, 'the submitted draft can no longer be edited');
  await fails(sys((db) => db.query(`update app.document_versions set pdf_blob = 'other.pdf' where id = $1`, [v1.id])), /is locked/, 'the database refuses to swap the locked PDF');
  await fails(approve('vic', 'VP-001'), /isn’t waiting for approval/, 'no approval before review');
  await as('omar', (db, me) => docs.review(db, me, 'VP-001', 'Looks right'));
  ok(await docState('VP-001') === 'In approval', 'review complete: In approval');
  const ta = await sys((db) => rows<any>(db, `select assignee_id from app.tasks where record_number = 'VP-001' and kind = 'approve-doc' and status = 'open'`));
  ok(ta.length === 1 && ta[0].assignee_id === ids.vic, 'the QA approver has an approve task');
  await fails(approve('daniel', 'VP-001'), /QA approver/, 'only a QA approver on the document can approve');
  await fails(approve('vic', 'VP-001', { retrain: false, reason: 'n/a' }), /why no retraining/, '"no retraining" needs a reason');
  ok((await approve('vic', 'VP-001')).sent === true, 'last approval: sent to Adobe Sign at once');
  const e1 = await sentFor('VP-001');
  ok(e1.transactionNo === base + 1 && e1.allowanceYear === a0.year && e1.status === 'sent', `one transaction counted: ${e1.transactionNo} of ${a0.year}`);
  ok(e1.signers.map((s: any) => `${s.meaning}:${s.routingOrder}:${s.status}`).join(',') === 'Authored:1:sent,Reviewed:2:waiting,Approved:3:waiting', 'every signer added at once, in order: author, reviewer, QA approver; only the author has it');
  ok(e1.files.original.sha256 === pdf1.sha256 && e1.verification?.by === ids.priya, 'the agreement carries the locked PDF the author checked, and their check');
  ok(await docState('VP-001') === 'Signing', 'VP-001 is Signing');
  const t1 = await sys((db) => rows(db, `select kind, assignee_id from app.tasks where record_number = 'VP-001' and status = 'open' order by kind`));
  ok(t1.some((t: any) => t.kind === 'esign' && t.assignee_id === ids.priya) && t1.filter((t: any) => t.kind === 'fyi').length === 2 && !t1.some((t: any) => t.kind === 'approve-doc'), 'tasks: author signs now; reviewer and approver get FYIs');
  await fails(as('vic', (db, me) => signing.mockAct(db, deps, me, e1.id, 'sign')), /isn’t your turn/, 'QA approver cannot sign before the author and reviewer');
  await fails(approve('vic', 'VP-001'), /isn’t waiting for approval/, 'no second approval or agreement while one is out');
  await as('priya', (db, me) => signing.mockAct(db, deps, me, e1.id, 'sign'));
  const mid = await as('vic', (db, me) => signing.detail(db, me, e1.id));
  ok(mid.signers.find((s: any) => s.meaning === 'Reviewed')?.status === 'sent' && mid.signed === 1, 'after the author signs, the reviewer is up');
  await signAll(e1.id, ['omar', 'vic']);
  const d1 = await as('vic', (db, me) => signing.detail(db, me, e1.id));
  ok(d1.status === 'completed' && d1.files.signed && d1.files.auditReport, 'agreement completed; signed PDF and audit report stored with hashes');
  ok(await docState('VP-001') === 'Effective', 'VP-001 is Effective');
  ok((await versionOf('VP-001')).cr_state === 'Closed', 'its change request CR-019 closed');
  const sig1 = await sys((db) => rows(db, `select meaning, source from app.signatures where record_number = 'VP-001' order by meaning`));
  ok(sig1.length === 3 && sig1.every((s: any) => s.source === 'simulated'), '3 signatures recorded, as simulated (mock Adobe Sign: not Part 11)');
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
  const ap4 = await sys((db) => rows<any>(db, `select status, retrain from app.document_approvers a join app.documents d on d.id = a.document_id where d.number = 'POL-004'`));
  ok(ap4.every((a) => a.status === 'Waiting' && a.retrain === null), 'cancelled: the approvals are undone; it goes through review and approval again');
  const sha4 = await submitDoc('sam', 'POL-004', [ids.priya!], [ids.vic!, ids.tom!]);
  ok(await docState('POL-004') === 'In review', 'resubmitted for review');
  await fails(as('omar', (db, me) => docs.review(db, me, 'POL-004')), /pending reviewer/, 'only a named reviewer can review');
  await as('priya', (db, me) => docs.review(db, me, 'POL-004', 'Fine'));
  ok(await docState('POL-004') === 'In approval', 'last reviewer: In approval');
  ok((await approve('vic', 'POL-004', { retrain: false, reason: 'Wording only; what staff do is unchanged.' })).sent === false && await docState('POL-004') === 'In approval', 'first of two approvals: nothing sent yet');
  await fails(as('daniel', (db, me) => docs.sendBack(db, me, 'POL-004', 'Not for me')), /Only a reviewer, an approver/, 'someone not on the document cannot return it');
  await as('tom', (db, me) => docs.sendBack(db, me, 'POL-004', 'Clause 4 needs the 60-minute rule for leavers'));
  ok(await docState('POL-004') === 'Draft', 'a QA approver returned it to the author');
  const rt = await sys((db) => rows<any>(db, `select note from app.tasks where record_number = 'POL-004' and kind = 'resubmit' and status = 'open'`));
  ok(rt.length === 1 && /60-minute/.test(rt[0].note), 'the author has a resubmit task with the reason');
  await as('sam', (db, me) => docs.submit(db, me, 'POL-004', V, sha4));
  await as('priya', (db, me) => docs.review(db, me, 'POL-004', 'Fine'));
  await approve('vic', 'POL-004', { retrain: false, reason: 'Wording only; what staff do is unchanged.' });
  ok((await approve('tom', 'POL-004', { retrain: false, reason: 'Clarifies an existing rule; no new steps.' })).sent === true, 'second approval: sent');
  const v4b = await versionOf('POL-004');
  ok(v4b.retrain === false && /Wording only/.test(v4b.retrain_reason) && /no new steps/.test(v4b.retrain_reason), 'both approvers said no retraining: recorded on the version with their reasons');
  const e5 = await sentFor('POL-004');
  ok(e5.correctionOf === e4.id && e5.transactionNo === base + 2, 'correction send: linked to the cancelled agreement, counted as a new transaction');
  await as('sam', (db, me) => signing.mockAct(db, deps, me, e5.id, 'sign'));
  await as('priya', (db, me) => signing.mockAct(db, deps, me, e5.id, 'decline', 'Section 3 contradicts SOP-018'));
  const d5 = await as('sam', (db, me) => signing.detail(db, me, e5.id));
  ok(d5.status === 'declined' && /SOP-018/.test(d5.reason ?? ''), 'declined with the reason recorded');
  ok(await docState('POL-004') === 'Draft', 'declined: POL-004 back to Draft');
  const v4c = await versionOf('POL-004');
  ok(v4c.retrain === true && v4c.retrain_reason === null && v4c.cr_state === 'In execution', 'declined: the retraining decision is reset; the change request stays open');
  const rs = await sys((db) => rows(db, `select note from app.tasks where record_number = 'POL-004' and kind = 'resubmit' and status = 'open'`));
  ok(rs.length === 1 && /SOP-018/.test((rs[0] as any).note), 'author has a resubmit task with the reason');

  console.log('Route 1: new document from draft to Effective');
  const groups = await sys((db) => rows<{ name: string }>(db, 'select name from app.groups order by name'));
  const nd = await as('sam', (db, me) => docs.create(db, me, { docType: 'Procedure', title: 'Firewall Change Procedure', classification: 'Internal', ownerId: ids.sam!, process: 'ISMS · Network',
    audience: { groups: ['Support team'], roles: [], users: [ids.lena!], daysToComplete: 10, quiz: false } }));
  ok(/^SOP-\d+$/.test(nd.number), `numbered ${nd.number}`);
  ok((await versionOf(nd.number)).cr_state === 'In execution', 'creating a document opened its change request');
  const noAudience = { groups: [], roles: [], users: [], daysToComplete: 14, quiz: false };
  const uar = await as('vic', (db, me) => docs.create(db, me, { docType: 'User access review', title: 'Q4 access review: finance systems', classification: 'Confidential', ownerId: ids.vic!, process: 'ISMS · Access control', audience: noAudience }));
  const ra = await as('vic', (db, me) => docs.create(db, me, { docType: 'Risk assessment', title: 'Cloud backup provider risk assessment', classification: 'Confidential', ownerId: ids.vic!, process: 'ISMS · Risk', audience: noAudience }));
  ok(uar.number === 'UAR-001' && ra.number === 'RA-001', `new document types: ${uar.number} and ${ra.number}, approved through Adobe Sign like any controlled document`);
  await as('sam', (db, me) => docs.saveDraft(db, me, nd.number, [{ t: 'h', x: '1. Purpose' }, { t: 'p', x: 'Control firewall changes.' }], 'First draft'));
  const firstPdf = (await makePdf('sam', nd.number, [], [ids.tom!])).sha256;
  await as('sam', (db, me) => docs.saveDraft(db, me, nd.number, [{ t: 'h', x: '1. Purpose' }, { t: 'p', x: 'Control and record firewall changes.' }], 'First draft'));
  ok(!(await versionOf(nd.number)).pdf_blob, 'editing the draft clears its PDF');
  await fails(as('sam', (db, me) => docs.submit(db, me, nd.number, V, firstPdf)), /Make the PDF/, 'so the old PDF cannot be submitted');
  await submitDoc('sam', nd.number, [], [ids.tom!]);
  ok(await docState(nd.number) === 'In approval', 'no reviewers: straight to approval');
  await approve('tom', nd.number);
  const e6 = await sentFor(nd.number);
  ok(e6.signers.length === 2 && e6.status === 'sent', 'sent with the author and the QA approver');
  await signAll(e6.id, ['sam', 'tom']);
  ok(await docState(nd.number) === 'Effective', `${nd.number} Effective`);
  const tr6 = await sys((db) => rows<any>(db, `select user_id from app.training_records where document_number = $1 and completed_at is null`, [nd.number]));
  ok(tr6.some((r) => r.user_id === ids.daniel) && tr6.some((r) => r.user_id === ids.lena) && !tr6.some((r) => r.user_id === ids.jake), 'audience (Support team + Lena) allocated; others not');
  const nv = await as('sam', (db, me) => docs.newVersion(db, me, nd.number, 'minor', 'Typo fix'));
  ok(nv.version === '0.2' && /^CR-\d+$/.test(nv.changeRequest), `new minor version 0.2 started from the effective 0.1, with its change request ${nv.changeRequest}`);

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
  await submitDoc('sam', nd.number, [], [ids.vic!]);
  await approve('vic', nd.number, { retrain: false, reason: 'Typo fix only; what people do is unchanged.' }, ldeps);
  const e7 = await sentFor(nd.number);
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
  const sig7 = await sys((db) => rows<any>(db, `select source from app.signatures where agreement_id = $1`, [e7.id]));
  ok(c7.provider === 'adobe' && sig7.length === 2 && sig7.every((s) => s.source === 'adobe'), 'with Adobe Sign live, the agreement and its signatures are recorded as Adobe Sign');
  // v0.2 needed no retraining: v0.1 training still counts, so nobody is allocated v0.2 and open v0.1 allocations stay open.
  const v01 = await sys((db) => rows<any>(db, `select r.version, r.closed_at from app.training_records r where r.document_number = $1 and r.completed_at is null`, [nd.number]));
  ok(v01.length > 0 && v01.every((r) => r.version === '0.1' && !r.closed_at), 'no retraining: open v0.1 allocations stay open and nobody is allocated v0.2');
  const dan = (await as('daniel', (db) => training.listRecords(db, { userId: ids.daniel }))).find((r: any) => r.documentNumber === nd.number);
  ok(dan?.status === 'Assigned', 'and Daniel’s v0.1 record still counts (Assigned, not Superseded)');
  // Adobe Sign reports a signer's rejection as CANCELLED; the REJECTED event makes it a decline, not a cancellation.
  const tomEmail = await emailOf('tom');
  await submitDoc('vic', 'POL-003', [], [ids.tom!]);
  await approve('tom', 'POL-003', {}, ldeps);
  const e8 = await sentFor('POL-003');
  agState = { status: 'CANCELLED', cancelComment: null, outcomes: [{ email: vicEmail, outcome: 'signed', at: new Date().toISOString(), comment: null }, { email: tomEmail, outcome: 'declined', at: new Date().toISOString(), comment: 'Section 3 contradicts the handling standard.' }] };
  await sys((db) => signing.fromProvider(db, ldeps, e8.id, 'webhook'));
  const d8 = await as('vic', (db, me) => signing.detail(db, me, e8.id));
  ok(d8.status === 'declined' && d8.reason === 'Section 3 contradicts the handling standard.' && (await docState('POL-003')) === 'Draft', 'rejected in Adobe Sign (reported as CANCELLED): declined with the signer’s reason; POL-003 back to Draft');

  console.log('SharePoint (mock): publishing, sync, integrity alerts, hash check');
  const spm = createSharePoint(loadConfig({ DATABASE_URL: 'unused', LOCAL_STORAGE_DIR: await mkdtemp(join(tmpdir(), 'veqms-sp-')) }));
  const spDeps = { sharepoint: spm, storage: storage as any };
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const r0 = await sys((db) => sp.runSync(db, spDeps));
  ok(r0.publish.published === 3 && r0.publish.failed === 0, `Effective versions published to the controlled library: ${r0.publish.published} (VP-001 v1.0, ${nd.number} v0.1 and v0.2)`);
  const vpPub = await versionOf('VP-001');
  ok(vpPub.publish_status === 'published' && sha(await spm.download('controlled', vpPub.published_item_id)) === vpPub.content_sha256, 'the published file is the locked PDF, byte for byte');
  const cols = await spm.fields('controlled', vpPub.published_item_id);
  ok(cols.DocumentNumber === 'VP-001' && cols.DocumentVersion === '1.0' && cols.DocumentStatus === 'Effective' && cols.SHA256 === vpPub.content_sha256, 'its columns: number, version, status, effective date, hash');
  const sup01 = await sys((db) => one<any>(db, `select v.publish_status, v.published_item_id from app.document_versions v join app.documents d on d.id = v.document_id where d.number = $1 and v.version = '0.1'`, [nd.number]));
  ok(r0.publish.superseded === 1 && sup01.publish_status === 'superseded' && (await spm.fields('controlled', sup01.published_item_id)).DocumentStatus === 'Superseded', 'the superseded version’s file stays in the library, marked Superseded');
  ok(r0.drafts.outcome === 'ok' && r0.controlled.outcome === 'ok' && r0.controlled.alerts === 0, 'first sync of both libraries: a starting point, no alerts');
  const r1 = await sys((db) => sp.syncLibrary(db, spm, 'controlled'));
  ok(r1.alerts === 0, 'VeQMS’s own writes to the controlled library raise nothing');
  await sys((db) => sp.simulateOutsideEdit(db, spm, 'VP-001', 'a SharePoint user (simulated)'));
  const r2 = await sys((db) => sp.syncLibrary(db, spm, 'controlled'));
  ok(r2.outcome === 'ok' && r2.alerts === 1, 'an edit made outside VeQMS raises an integrity alert');
  ok((await sys((db) => sp.syncLibrary(db, spm, 'controlled'))).changes === 0, 'the next sync resumes from its token');
  const h = await sys((db) => sp.hashCheck(db, spm));
  ok(h.checked === 2 && h.mismatches === 1, `nightly hash check: ${h.checked} published files, ${h.mismatches} no longer matches its locked PDF`);
  const al = await sys((db) => rows<any>(db, `select id, kind from app.integrity_alerts where resolved_at is null order by raised_at`));
  ok(al.map((a) => a.kind).join() === 'outside-change,hash-mismatch', 'two open alerts: outside change and hash mismatch');
  const qmNote = await sys((db) => rows<any>(db, `select title from app.notifications where user_id = $1 and title = 'Integrity alert: VP-001'`, [ids.vic]));
  ok(qmNote.length === 2, 'the Quality Manager is told of each');
  await as('vic', (db, me) => sp.resolveAlert(db, me, al[0].id, 'Restored the file from the locked PDF; the user was reminded the library is read-only.'));
  await fails(as('vic', (db, me) => sp.resolveAlert(db, me, al[0].id, 'Resolving it a second time.')), /already resolved/, 'an alert is resolved once');
  await fails(sys((db) => db.query(`update app.integrity_alerts set detail = 'nothing' where id = $1`, [al[1].id])), /only the resolution/, 'the database refuses to change what an alert says');
  await sys((db) => db.query(`update app.document_versions set publish_status = 'pending' where id = (select v.id from app.document_versions v join app.documents d on d.id = v.document_id where d.number = 'SOP-012' and v.version = '3.0')`));
  for (let i = 0; i < sp.MAX_PUBLISH_ATTEMPTS; i++) await sys((db) => sp.publishPending(db, spDeps));
  const pf = await sys((db) => one<any>(db, `select v.publish_status, v.publish_attempts, (select count(*)::int from app.dead_letters where job = 'sharepoint-publish') as dead,
    (select count(*)::int from app.integrity_alerts where kind = 'publish-failed' and resolved_at is null) as alerts
    from app.document_versions v join app.documents d on d.id = v.document_id where d.number = 'SOP-012' and v.version = '3.0'`));
  ok(pf.publish_status === 'failed' && pf.publish_attempts === sp.MAX_PUBLISH_ATTEMPTS && pf.dead === 1 && pf.alerts === 1, 'a publish that keeps failing is retried, then goes to dead letters and alerts QA');

  console.log('SharePoint live path (Graph faked): Word file, conversion, change checks');
  let wordTag = '"c:1"';
  const made: { name: string; bytes: Uint8Array }[] = [];
  const onePage = await (async () => { const p = await PDFDocument.create(); p.addPage(); return p.save(); })();
  const fakeLive = { ...spm, mode: 'live' as const, appId: 'veqms-app',
    createDraft: async (name: string, bytes: Uint8Array) => { made.push({ name, bytes }); return { id: 'word-1', name, webUrl: 'https://example.sharepoint.com/Drafts/' + name, cTag: wordTag }; },
    getItem: async (_lib: string, id: string) => ({ id, name: 'word.docx', webUrl: 'https://example.sharepoint.com/Drafts/word.docx', cTag: wordTag }),
    pdfOf: async () => onePage,
    delta: async () => ({ changes: [{ id: 'word-1', name: 'word.docx', deleted: false, folder: false, modifiedAt: new Date().toISOString(), cTag: wordTag, byApp: null, byUser: 'u1', byName: 'Jim Speir' }], token: 't1' }) };
  const wd = await as('sam', (db, me) => docs.create(db, me, { docType: 'Work instruction', title: 'Badge printer setup', classification: 'Internal', ownerId: ids.sam!, process: 'ISMS · Physical security', audience: noAudience }, fakeLive as any));
  ok(made.length === 1 && made[0]!.name === `${wd.number} Badge printer setup.docx` && Buffer.from(made[0]!.bytes).subarray(0, 2).toString() === 'PK', 'a new document starts as a Word file in the Drafts library');
  await fails(as('sam', (db, me) => docs.saveDraft(db, me, wd.number, [{ t: 'p', x: 'Typed in VeQMS' }], 'x', fakeLive as any)), /written in Word/, 'its text is written in Word, not in VeQMS');
  const wp = await as('sam', (db, me) => docs.preparePdf(db, me, storage as any, wd.number, [], [ids.tom!], fakeLive as any));
  const wv = await versionOf(wd.number);
  ok(wv.pdf_source_tag === '"c:1"' && (await PDFDocument.load(files.get(wv.pdf_blob)!)).getPageCount() === 2, 'the PDF is the converted Word file plus the signature page, tied to that state of the file');
  wordTag = '"c:2"';
  await fails(as('sam', (db, me) => docs.submit(db, me, wd.number, V, wp.sha256, fakeLive as any)), /Word file changed after the PDF/, 'submit refused when the Word file changed after its PDF was made');
  await sys((db) => sp.syncLibrary(db, fakeLive as any, 'drafts'));
  const wv2 = await versionOf(wd.number);
  ok(!wv2.pdf_blob && !wv2.pdf_source_tag, 'the drafts sync clears a PDF made from an older state of the Word file');
  const expiring = { ...spm, delta: async (lib: any, token: string | null) => { if (token) throw new DeltaExpired(lib); return { changes: [], token: 'fresh-token' }; } };
  const rx = await sys((db) => sp.syncLibrary(db, expiring as any, 'controlled'));
  const lastRun = await sys((db) => one<any>(db, `select outcome, delta_token from app.sync_runs where library = 'controlled' order by started_at desc limit 1`));
  const told = await sys((db) => rows<any>(db, `select 1 from app.notifications where user_id = $1 and title = 'SharePoint sync restarted (controlled library)'`, [ids.vic]));
  ok(rx.outcome === 'ok' && lastRun.delta_token === 'fresh-token' && told.length === 1, 'an expired change token: the sync restarts from now and QA is told');

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
  await submitDoc('sam', 'POL-004', [], [ids.vic!]);
  await fails(approve('vic', 'POL-004'), /Adobe Sign transactions is used up/, 'last approval refused when the allowance of transactions is used up');
  const st = await sys((db) => one<any>(db, `select d.state, a.status from app.documents d join app.document_approvers a on a.document_id = d.id where d.number = 'POL-004'`));
  ok(st.state === 'In approval' && st.status === 'To approve', 'nothing half-done: the approval rolled back and can be given once the allowance is raised');
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
