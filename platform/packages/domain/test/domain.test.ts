import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planDocumentAgreement, planClosureAgreement, verificationComplete, currentOrder, documentSubject,
  allowanceYear, allowanceState, ackStatement, inAudience, trainingStatus, matrixCell, can, canBeApprover,
  secretMatches, webhookEcho, mapAgreementStatus, participantEvent, xlsx, type UserRef, type Audience
} from '../src/index.ts';

const U = (id: string, roles: UserRef['roles'], groups: string[] = ['All staff'], status: UserRef['status'] = 'active'): UserRef => ({ id, name: id.toUpperCase(), email: id + '@example.test', status, roles, groups });
const vic = U('vic', ['qm', 'approver']), sam = U('sam', ['author']), priya = U('priya', ['reviewer']), tom = U('tom', ['approver']), admin = U('lucy', ['admin']);

test('document agreement: author, then reviewers, then QA approvers, with meanings', () => {
  const p = planDocumentAgreement({ documentNumber: 'POL-004', title: 'Access Control Policy', version: '2.0', author: sam, reviewers: [priya], approvers: [vic, tom] });
  assert.deepEqual(p.signers.map((s) => [s.userId, s.meaning, s.routingOrder]), [['sam', 'Authored', 1], ['priya', 'Reviewed', 2], ['vic', 'Approved', 3], ['tom', 'Approved', 4]]);
  assert.equal(p.subject, 'POL-004 v2.0 · Access Control Policy · Approval');
  assert.deepEqual(p.problems, []);
});

test('document agreement without reviewers puts the QA approver second', () => {
  const p = planDocumentAgreement({ documentNumber: 'WI-003', title: 'X', version: '1.0', author: sam, reviewers: [], approvers: [tom] });
  assert.deepEqual(p.signers.map((s) => s.routingOrder), [1, 2]);
});

test('segregation of duties: author, reviewer or admin-only account cannot be QA approver', () => {
  assert.match(planDocumentAgreement({ documentNumber: 'P', title: 'T', version: '1.0', author: vic, reviewers: [], approvers: [vic] }).problems.join(), /authored this version/);
  assert.match(planDocumentAgreement({ documentNumber: 'P', title: 'T', version: '1.0', author: sam, reviewers: [tom], approvers: [tom] }).problems.join(), /is a reviewer/);
  assert.match(planDocumentAgreement({ documentNumber: 'P', title: 'T', version: '1.0', author: sam, reviewers: [], approvers: [admin] }).problems.join(), /Approver or Quality Manager/);
  assert.match(planDocumentAgreement({ documentNumber: 'P', title: 'T', version: '1.0', author: sam, reviewers: [], approvers: [] }).problems.join(), /Choose a QA approver/);
  assert.match(planDocumentAgreement({ documentNumber: 'P', title: 'T', version: '1.0', author: U('x', ['author'], [], 'left'), reviewers: [], approvers: [tom] }).problems.join(), /not an active user/);
  assert.equal(canBeApprover(['admin']), false);
});

test('closure agreement: owner then QA approver; owner cannot approve own closure', () => {
  const ok = planClosureAgreement({ recordNumber: 'CAPA-005', title: 'Phishing follow-up', purpose: 'CAPA closure', owner: priya, approver: vic, hasClosureText: true });
  assert.deepEqual(ok.signers.map((s) => [s.userId, s.meaning, s.routingOrder]), [['priya', 'Authored', 1], ['vic', 'Approved', 2]]);
  assert.deepEqual(ok.problems, []);
  const bad = planClosureAgreement({ recordNumber: 'QE-017', title: 'Late test', purpose: 'Deviation closure', owner: vic, approver: vic, hasClosureText: false });
  assert.equal(bad.problems.length, 2);
});

test('verification check needs all four ticks', () => {
  assert.equal(verificationComplete({ footer: true, version: true, documentId: true, dates: true }), true);
  assert.equal(verificationComplete({ footer: true, version: true, documentId: true }), false);
  assert.equal(verificationComplete(null), false);
});

test('current routing order advances when the whole order has signed', () => {
  assert.equal(currentOrder([{ routingOrder: 1, status: 'signed' }, { routingOrder: 2, status: 'sent' }, { routingOrder: 2, status: 'signed' }, { routingOrder: 3, status: 'waiting' }]), 2);
  assert.equal(currentOrder([{ routingOrder: 1, status: 'signed' }]), null);
});

test('long subjects fall back to ID and version', () => {
  assert.equal(documentSubject('SOP-001', '1.0', 'x'.repeat(200)), 'SOP-001 v1.0 · Approval');
});

test('allowance year honours the configured start month (UTC)', () => {
  const y = allowanceYear(new Date(Date.UTC(2026, 1, 10)), 4); // 10 Feb 2026, year starts April
  assert.equal(y.year, 2025); assert.equal(y.start.toISOString(), '2025-04-01T00:00:00.000Z'); assert.equal(y.end.toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(allowanceYear(new Date(Date.UTC(2026, 10, 19))).year, 2026);
  assert.throws(() => allowanceYear(new Date(), 13));
  assert.deepEqual(allowanceState(500, 497, 50), { allowance: 500, used: 497, remaining: 3, low: true, exhausted: false });
  assert.equal(allowanceState(500, 500, 50).exhausted, true);
});

test('acknowledgement statement names the document and version', () => {
  assert.equal(ackStatement('I confirm I have read and understood {doc}, version {version}', 'WI 6.2', '4.0'), 'I confirm I have read and understood WI 6.2, version 4.0');
});

test('audience membership by group, role or named person; inactive users never', () => {
  const a: Audience = { groups: ['IT team'], roles: ['qm'], users: ['daniel'], daysToComplete: 14, quiz: false };
  assert.equal(inAudience(a, U('jake', ['employee'], ['All staff', 'IT team'])), true);
  assert.equal(inAudience(a, vic), true);
  assert.equal(inAudience(a, U('daniel', ['employee'])), true);
  assert.equal(inAudience(a, U('lena', ['employee'])), false);
  assert.equal(inAudience(a, U('mark', ['employee'], ['IT team'], 'left')), false);
});

test('training status: superseded, corrected, correction, withdrawn, overdue, complete', () => {
  const now = new Date('2026-11-19T10:00:00Z');
  const base = { id: 'r1', userId: 'u', documentId: 'd', version: '3.0', dueAt: '2026-11-25T17:00:00Z', completedAt: null, closedAt: null, correctionOf: null, noRetrain: false };
  const ctx = { now, effectiveVersion: '3.0', correctedIds: new Set<string>() };
  assert.equal(trainingStatus(base, ctx), 'Assigned');
  assert.equal(trainingStatus({ ...base, dueAt: '2026-11-01T00:00:00Z' }, ctx), 'Overdue');
  assert.equal(trainingStatus({ ...base, completedAt: '2026-11-02T00:00:00Z' }, ctx), 'Complete');
  assert.equal(trainingStatus({ ...base, version: '2.1', completedAt: '2026-01-01T00:00:00Z' }, ctx), 'Superseded');
  assert.equal(trainingStatus({ ...base, closedAt: '2026-11-03T00:00:00Z' }, ctx), 'Withdrawn');
  assert.equal(trainingStatus(base, { ...ctx, correctedIds: new Set(['r1']) }), 'Corrected');
  assert.equal(trainingStatus({ ...base, correctionOf: 'r0', noRetrain: true }, ctx), 'Correction');
  assert.equal(trainingStatus(base, { ...ctx, effectiveVersion: null }), 'Obsolete');
  // v3.1 approved without retraining: training on v3.0 still counts.
  assert.equal(trainingStatus({ ...base, completedAt: '2026-11-02T00:00:00Z' }, { ...ctx, effectiveVersion: '3.1', equivalentVersions: ['3.0', '3.1'] }), 'Complete');
  assert.equal(trainingStatus({ ...base, version: '2.1', completedAt: '2026-01-01T00:00:00Z' }, { ...ctx, effectiveVersion: '3.1', equivalentVersions: ['3.0', '3.1'] }), 'Superseded');
});

test('matrix cell shows superseded training and missing allocations', () => {
  const a: Audience = { groups: ['All staff'], roles: [], users: [], daysToComplete: 14, quiz: true };
  const u = U('jake', ['employee']);
  const old = { id: 'o', userId: 'jake', documentId: 'd', version: '2.1', dueAt: null, completedAt: '2026-01-01T00:00:00Z', closedAt: null, correctionOf: null, noRetrain: false, status: 'Superseded' as const, assignedAt: '2025-12-01T00:00:00Z' };
  assert.deepEqual(matrixCell(u, a, '3.0', [old]), { status: 'Superseded', versionTrained: '2.1', currentVersion: '3.0', recordId: 'o' });
  assert.equal(matrixCell(u, a, '3.0', [])?.status, 'Not allocated');
  assert.equal(matrixCell(U('lena', ['employee'], []), a, '3.0', []), null);
  // 3.1 needed no retraining: Jake's 3.0 training is complete for 3.1.
  const done30 = { ...old, id: 'n', version: '3.0', completedAt: '2026-06-01T00:00:00Z', status: 'Complete' as const, assignedAt: '2026-05-01T00:00:00Z' };
  assert.deepEqual(matrixCell(u, a, '3.1', [old, done30], ['3.0', '3.1']), { status: 'Complete', versionTrained: '3.0', currentVersion: '3.1', recordId: 'n' });
});

test('permissions: auditor read-only, admin cannot manage training', () => {
  assert.equal(can(['auditor'], 'write'), false);
  assert.equal(can(['auditor'], 'approvals.view'), true);
  assert.equal(can(['admin'], 'training.manage'), false);
  assert.equal(can(['qm'], 'training.manage'), true);
});

test('Adobe Sign webhooks: secret token and client ID checks, echo, status and event mapping', () => {
  assert.equal(secretMatches('t0ken-abc', 't0ken-abc'), true);
  assert.equal(secretMatches('t0ken-abc', 't0ken-abd'), false);
  assert.equal(secretMatches('t0ken-abc', 't0ken'), false);
  assert.equal(secretMatches('', ''), false, 'an unset secret never matches');
  assert.equal(secretMatches('t0ken-abc', undefined), false);
  assert.deepEqual(webhookEcho('client-1'), { xAdobeSignClientId: 'client-1' });
  assert.equal(mapAgreementStatus('OUT_FOR_SIGNATURE'), 'sent');
  assert.equal(mapAgreementStatus('SIGNED'), 'completed');
  assert.equal(mapAgreementStatus('CANCELLED'), 'cancelled');
  assert.equal(mapAgreementStatus('ABORTED'), 'cancelled');
  assert.equal(mapAgreementStatus('EXPIRED'), 'cancelled');
  assert.equal(mapAgreementStatus('SOMETHING_NEW'), null);
  assert.equal(participantEvent('ESIGNED'), 'signed');
  assert.equal(participantEvent('REJECTED'), 'declined');
  assert.equal(participantEvent('EMAIL_VIEWED'), null);
});

test('xlsx export opens as a workbook with the generated-by stamp (checked with python openpyxl when available)', () => {
  const buf = xlsx('Training matrix', [['Person', 'Document', 'Status'], ['Jake', 'SOP-012', 'Overdue'], ['=1+1', 'x', 3]], { at: new Date('2026-11-19T10:00:00Z'), by: 'Victoria E.' });
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-')), file = join(dir, 'r.xlsx');
  writeFileSync(file, buf);
  try {
    const out = execFileSync('python3', ['-I', '-c', 'import sys,openpyxl; ws=openpyxl.load_workbook(sys.argv[1]).active; print([c for r in ws.iter_rows(values_only=True) for c in r if c is not None])', file]).toString();
    assert.match(out, /Generated by/); assert.match(out, /Victoria E\./); assert.match(out, /'=1\+1'/);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || /No module named/.test(String((e as { stderr?: Buffer }).stderr ?? ''))) return; // openpyxl not installed here
    throw e;
  }
});
