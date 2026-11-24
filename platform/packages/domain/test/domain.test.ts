import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, canSee, canDownload, sodBlock, documentPlan, closurePlan, allowanceYear, allowanceRange, remaining,
  trainingStatus, connectSignature, verifyConnectHmac, type PlanUser, type AssignmentFacts,
} from '../src/index.ts';

const sod = { adminCannotApprove: true, authorCannotApprove: true };
const u = (id: string, roles: PlanUser['roles'], active = true): PlanUser => ({ id, name: id, active, roles });

test('permissions: admin cannot approve; auditor is read-only', () => {
  assert.equal(can(['admin'], 'doc.approve'), false);
  assert.equal(can(['approver'], 'doc.approve'), true);
  assert.equal(can(['auditor'], 'write'), false);
  assert.equal(can(['auditor'], 'admin.audit'), true);
});

test('classification: involvement grants sight but not a Restricted download', () => {
  assert.equal(canSee('Internal', 'Restricted', false), false);
  assert.equal(canSee('Internal', 'Restricted', true), true);
  assert.equal(canDownload('Confidential', 'Restricted', true), false);
  assert.equal(canDownload('Restricted', 'Restricted', false), true);
  assert.equal(canDownload('Confidential', 'Internal', false), false);
});

test('segregation of duties: author, admin, CR owner and auditor refused', () => {
  assert.match(sodBlock({ id: 'a', roles: ['author', 'approver'] }, { kind: 'doc', authorId: 'a' }, sod) ?? '', /authored this version/);
  assert.match(sodBlock({ id: 's', roles: ['admin'] }, { kind: 'doc', authorId: 'a' }, sod) ?? '', /System Administrators/);
  assert.match(sodBlock({ id: 'p', roles: ['process'] }, { kind: 'cr', ownerId: 'p' }, sod) ?? '', /own this change request/);
  assert.match(sodBlock({ id: 'x', roles: ['auditor'] }, { kind: 'doc' }, sod) ?? '', /read-only/);
  assert.equal(sodBlock({ id: 'b', roles: ['approver'] }, { kind: 'doc', authorId: 'a' }, sod), null);
  assert.equal(sodBlock({ id: 'a', roles: ['author', 'approver'] }, { kind: 'doc', authorId: 'a' }, { ...sod, authorCannotApprove: false }), null);
});

test('document plan: author, parallel reviewers, then ordered approvers', () => {
  const p = documentPlan(u('auth', ['author']), [u('r1', ['reviewer']), u('r2', ['reviewer'])], [u('qa1', ['qm']), u('qa2', ['approver'])]);
  assert.deepEqual(p.signers.map((s) => [s.userId, s.order, s.meaning]), [
    ['auth', 1, 'Authored'], ['r1', 2, 'Reviewed'], ['r2', 2, 'Reviewed'], ['qa1', 3, 'Approved'], ['qa2', 4, 'Approved'],
  ]);
  assert.deepEqual(p.problems, []);
});

test('document plan refusals: no approver, author approves, reviewer approves, wrong role, inactive', () => {
  assert.deepEqual(documentPlan(u('a', ['author']), [], []).problems, ['Choose a QA approver.']);
  assert.match(documentPlan(u('a', ['author', 'approver']), [], [u('a', ['author', 'approver'])]).problems.join(), /segregation of duties/);
  assert.match(documentPlan(u('a', ['author']), [u('r', ['approver'])], [u('r', ['approver'])]).problems.join(), /is a reviewer/);
  assert.match(documentPlan(u('a', ['author']), [], [u('e', ['employee'])]).problems.join(), /doesn’t hold the Approver/);
  assert.match(documentPlan(u('a', ['author']), [], [u('q', ['qm'], false)]).problems.join(), /not an active user/);
  assert.match(documentPlan(u('a', ['author'], false), [], [u('q', ['qm'])]).problems.join(), /no longer active/);
});

test('closure plan: owner cannot approve; closure must be recorded first', () => {
  const ok = closurePlan(u('o', ['process']), [u('q', ['qm'])], true, 'capa');
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.signers.map((s) => s.order), [1, 2]);
  assert.match(closurePlan(u('o', ['qm']), [u('o', ['qm'])], true, 'deviation').problems.join(), /owns this record/);
  assert.match(closurePlan(u('o', ['process']), [u('q', ['qm'])], false, 'capa').problems.join(), /effectiveness result/);
  assert.match(closurePlan(u('o', ['process']), [u('q', ['qm'])], false, 'deviation').problems.join(), /closure justification/);
});

test('allowance year boundaries match the database function', () => {
  assert.equal(allowanceYear(new Date('2026-02-10T00:00:00Z'), 4), 2025);
  assert.equal(allowanceYear(new Date('2026-04-01T00:00:00Z'), 4), 2026);
  assert.equal(allowanceYear(new Date('2026-12-31T23:59:59Z'), 1), 2026);
  assert.throws(() => allowanceYear(new Date(), 13), RangeError);
  const r = allowanceRange(new Date('2026-11-24T00:00:00Z'), 4);
  assert.equal(r.start.toISOString(), '2026-04-01T00:00:00.000Z');
  assert.equal(r.end.toISOString(), '2027-04-01T00:00:00.000Z');
  assert.equal(remaining(500, 499), 1);
  assert.equal(remaining(500, 510), 0);
});

test('training status follows the prototype order', () => {
  const now = new Date('2026-11-24T12:00:00Z');
  const base: AssignmentFacts = {
    isCorrection: false, hasCorrections: false, effectiveVersionId: 'v2', versionId: 'v2', withdrawn: false,
    completedAt: null, userLeft: false, dueAt: new Date('2026-11-24T00:00:00Z'),
  };
  assert.equal(trainingStatus(base, now), 'Assigned', 'due today is not overdue');
  assert.equal(trainingStatus({ ...base, dueAt: new Date('2026-11-23T23:59:00Z') }, now), 'Overdue');
  assert.equal(trainingStatus({ ...base, completedAt: now }, now), 'Complete');
  assert.equal(trainingStatus({ ...base, versionId: 'v1' }, now), 'Superseded');
  assert.equal(trainingStatus({ ...base, effectiveVersionId: null }, now), 'Obsolete');
  assert.equal(trainingStatus({ ...base, hasCorrections: true, completedAt: now }, now), 'Corrected');
  assert.equal(trainingStatus({ ...base, isCorrection: true }, now), 'Correction');
  assert.equal(trainingStatus({ ...base, userLeft: true }, now), 'Left');
  assert.equal(trainingStatus({ ...base, withdrawn: true }, now), 'Withdrawn');
});

test('Connect HMAC: valid, tampered body, wrong key, key rotation, no header', () => {
  const body = Buffer.from('{"event":"envelope-completed"}');
  const sig = connectSignature(body, 'key-1');
  assert.equal(verifyConnectHmac(body, [sig], ['key-1']), true);
  assert.equal(verifyConnectHmac(Buffer.from('{"event":"envelope-voided"}'), [sig], ['key-1']), false);
  assert.equal(verifyConnectHmac(body, [sig], ['key-2']), false);
  assert.equal(verifyConnectHmac(body, ['junk', sig], ['key-0', 'key-1']), true);
  assert.equal(verifyConnectHmac(body, [], ['key-1']), false);
  assert.equal(verifyConnectHmac(body, [sig], []), false);
});
