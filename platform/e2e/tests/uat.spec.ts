// The Phase 1 UAT scenarios from docs/07-testing-and-validation.md, driven through the web app as each persona.
// DocuSign runs in mock mode: each signer signs on the record page when it is their turn.
// Run once, in order, against a freshly seeded database. Scenarios touch different records, so one failing
// doesn't stop the others.
import { test, expect } from '@playwright/test';
import { signIn, expectOk, expectRefused, mockSign, mockDecline, verifyAndSend, expectDocState } from './helpers';

test('1 · Victoria cannot send POL-003 she wrote: blocked on screen and logged, refused by the API and logged', async ({ browser }) => {
  const vic = await signIn(browser, 'victoria');
  await vic.goto('/documents/POL-003/send');
  await expect(vic.locator('.callout.warn[role=alert]')).toContainText(/segregation of duties/i);
  await expect(vic.getByRole('button', { name: 'Send to DocuSign' })).toBeDisabled();

  // Being shown the block is itself logged.
  await vic.goto('/admin?tab=audit&objectId=POL-003');
  await expect(vic.locator('main tbody tr', { hasText: 'Send page shown with sending blocked' })).toHaveCount(1);
  await vic.goto('/documents/POL-003/send');

  // The API checks again even if the browser is bypassed: enable the button and post the form anyway.
  for (const c of await vic.getByRole('group', { name: /Verification check/ }).getByRole('checkbox').all()) await c.check();
  await vic.getByRole('button', { name: 'Send to DocuSign' }).evaluate((b) => b.removeAttribute('disabled'));
  await vic.getByRole('button', { name: 'Send to DocuSign' }).click();
  await expectRefused(vic, /segregation of duties/i);

  // The refusal reached the audit trail even though the request rolled back.
  await vic.goto('/admin?tab=audit&objectId=POL-003');
  await expect(vic.locator('main tbody tr', { hasText: /send blocked: .*segregation of duties/i })).toHaveCount(1);
});

test('2 · VP-001: verify and send, sign in order, becomes Effective, training follows', async ({ browser }) => {
  const vic = await signIn(browser, 'victoria');
  await vic.goto('/documents/VP-001/send');
  await verifyAndSend(vic);
  await expectOk(vic, 'Sent to DocuSign');
  await expectDocState(vic, 'VP-001', 'In approval');

  // Victoria is the QA approver, so she has no Sign button until the author and reviewer have signed.
  await expect(vic.getByRole('button', { name: /^Sign \(/ })).toHaveCount(0);

  const carrie = await signIn(browser, 'carrie');
  await mockSign(carrie, '/documents/VP-001', 'Authored');
  const omar = await signIn(browser, 'omar');
  await mockSign(omar, '/documents/VP-001', 'Reviewed');
  await mockSign(vic, '/documents/VP-001', 'Approved');
  await expectDocState(vic, 'VP-001', 'Effective');

  // Signing the envelope counts as training for the author and reviewer.
  await vic.goto('/documents/VP-001?tab=training');
  for (const name of ['Carrie Foreman', 'Omar Haddad']) {
    await expect(vic.locator('main tr', { hasText: name })).toContainText('Complete');
  }
  // The IT team (here Jim) now has VP-001 to read.
  const jim = await signIn(browser, 'jim');
  await jim.goto('/training');
  await expect(jim.locator('main')).toContainText('VP-001');
});

test('3 · POL-004: void, resubmit, corrected send, decline back to draft', async ({ browser }) => {
  const jim = await signIn(browser, 'jim');
  await jim.goto('/documents/POL-004?tab=approval');
  await jim.getByText('Void this envelope').click();
  await jim.getByLabel('Reason (required)').fill('Section 4 still names the old leaver process.');
  await jim.getByRole('button', { name: 'Void envelope' }).click();
  await expectOk(jim, 'Envelope voided');
  await expectDocState(jim, 'POL-004', 'Draft');

  // Resubmit with Carrie as the only reviewer.
  await jim.goto('/documents/POL-004/submit');
  const reviewers = jim.getByRole('group', { name: /Reviewers/ });
  for (const c of await reviewers.getByRole('checkbox').all()) await c.uncheck();
  await reviewers.getByLabel(/Carrie Foreman/).check();
  await jim.getByRole('button', { name: 'Submit for review' }).click();
  await expectOk(jim, 'Submitted');

  const carrie = await signIn(browser, 'carrie');
  await carrie.goto('/documents/POL-004');
  await carrie.getByText('Mark reviewed', { exact: true }).first().click();
  await carrie.getByRole('button', { name: 'Mark reviewed' }).click();
  await expectOk(carrie, 'Marked reviewed');
  await expectDocState(carrie, 'POL-004', 'Review closed');

  // The corrected envelope is a new send, linked to the voided one.
  await jim.goto('/documents/POL-004/send');
  await verifyAndSend(jim);
  await expectOk(jim, 'Sent to DocuSign');
  await expect(jim.locator('main')).toContainText('Correction');

  await mockSign(jim, '/documents/POL-004', 'Authored');
  await mockDecline(carrie, '/documents/POL-004', 'The access review frequency contradicts SOP-018.');
  await expectDocState(jim, 'POL-004', 'Draft');
});

test('4 · Daniel confirms SOP-012 with the quiz; a correction leaves the original marked Corrected', async ({ browser }) => {
  const daniel = await signIn(browser, 'daniel');
  await daniel.goto('/training');
  await daniel.locator('main div', { has: daniel.getByText(/^SOP-012 Backup and Restore Procedure/) }).getByRole('link', { name: 'Start' }).first().click();
  await expect(daniel).toHaveURL(/\/training\/[0-9a-f-]{36}$/);
  const recordUrl = daniel.url();
  // Answers from the demo seed: every quarter; 1 hour; encrypted and copied to a second region.
  await daniel.getByRole('group', { name: /How often is a restore test run/ }).getByLabel('Every quarter').check();
  await daniel.getByRole('group', { name: /recovery point objective/ }).getByLabel('1 hour').check();
  await daniel.getByRole('group', { name: /Where are backup copies kept/ }).getByLabel(/Encrypted/).check();
  await daniel.getByRole('checkbox', { name: /I confirm I have read and understood SOP-012/ }).check();
  await daniel.getByRole('button', { name: 'Confirm read and understood' }).click();
  await expectOk(daniel, 'Recorded');

  // He can't confirm twice.
  await daniel.goto(recordUrl);
  await expect(daniel.getByRole('heading', { name: 'Nothing to confirm' })).toBeVisible();

  // Victoria corrects his record and asks him to retrain.
  const vic = await signIn(browser, 'victoria');
  await vic.goto('/documents/SOP-012?tab=training');
  await vic.locator('main tr', { hasText: 'Daniel Greenwood' }).getByRole('link', { name: 'Daniel Greenwood' }).click();
  await vic.getByLabel('Reason (logged)').fill('Confirmed on a shared terminal; Daniel to retrain in person.');
  await vic.getByLabel(/Allocate the training again/).check();
  await vic.getByRole('button', { name: 'Record correction' }).click();
  await expectOk(vic, 'Correction recorded');
  await expect(vic.locator('.page-head')).toContainText('Corrected');
});

test('5 · CAPA-005: effectiveness result, closure sent, Carrie and Victoria sign, CAPA-005 and QE-013 close', async ({ browser }) => {
  const carrie = await signIn(browser, 'carrie');
  await carrie.goto('/quality/capas/CAPA-005');
  await carrie.getByLabel('Result').fill('The November simulation: 1 of 22 staff clicked, down from 6. Training is working.');
  await carrie.getByLabel(/Effective: close the CAPA/).check();
  await carrie.getByRole('button', { name: 'Save result' }).click();
  await expectOk(carrie, 'Result recorded');
  await verifyAndSend(carrie);
  await expectOk(carrie, 'Closure sent to DocuSign');

  await mockSign(carrie, '/quality/capas/CAPA-005', 'Authored');
  const vic = await signIn(browser, 'victoria');
  await mockSign(vic, '/quality/capas/CAPA-005', 'Approved');

  await vic.goto('/quality');
  await expect(vic.locator('main tr', { hasText: 'CAPA-005' })).toContainText('Closed');
  await expect(vic.locator('main tr', { hasText: 'QE-013' })).toContainText('Closed');
});

test('6 · QE-017: justification, Victoria declines, Louise resends, both sign, QE-017 closes', async ({ browser }) => {
  const louise = await signIn(browser, 'louise');
  await louise.goto('/quality/events/QE-017');
  await louise.getByLabel('Justification (required)').fill('A one-off delay while the test server was rebuilt; the Q4 test ran on time and no process change is needed.');
  await louise.getByRole('button', { name: 'Save justification' }).click();
  await expectOk(louise, 'Justification saved');
  await verifyAndSend(louise);
  await expectOk(louise, 'Closure sent to DocuSign');
  await mockSign(louise, '/quality/events/QE-017', 'Authored');

  const vic = await signIn(browser, 'victoria');
  await mockDecline(vic, '/quality/events/QE-017', 'Add the date the Q4 test ran so the justification can be checked.');

  await louise.goto('/quality/events/QE-017');
  await verifyAndSend(louise);
  await expectOk(louise, 'Closure sent to DocuSign');
  await mockSign(louise, '/quality/events/QE-017', 'Authored');
  await mockSign(vic, '/quality/events/QE-017', 'Approved');

  await vic.goto('/quality');
  await expect(vic.locator('main tr', { hasText: 'QE-017' })).toContainText('Closed');
});

test('7 · Lucy revokes Jake: his session ends and his open training closes; she cannot change her own access', async ({ browser }) => {
  const jake = await signIn(browser, 'jake');
  await jake.goto('/training');
  await expect(jake.getByRole('heading', { name: /^To do · [1-9]/ })).toBeVisible();

  const lucy = await signIn(browser, 'lucy');
  await lucy.goto('/admin?tab=users');
  const row = lucy.locator('main tr', { hasText: 'Jake Turner' });
  await row.getByText('Change access').click();
  await row.getByLabel('Access').selectOption('revoked');
  await row.locator('input[id^="sr-"]').fill('Contract ended today.');
  await row.getByRole('button', { name: 'Save access' }).click();
  await expectOk(lucy, 'Access removed and sessions ended');

  // Jake's next request is refused: he is signed out and told why.
  await jake.goto('/today');
  await expect(jake).toHaveURL(/\/login/);
  await expect(jake.locator('.callout.warn[role=alert]')).toContainText('You don’t have access to VeQMS');

  // His open training is withdrawn and nothing is left open (Victoria can see everyone's records).
  const vic = await signIn(browser, 'victoria');
  await vic.goto('/admin?tab=users');
  await vic.locator('main tr', { hasText: 'Jake Turner' }).getByRole('link', { name: 'Jake Turner' }).click();
  await expect(vic.locator('main tbody')).not.toContainText(/Assigned|Overdue/);
  await vic.getByLabel('Status').selectOption('Withdrawn');
  await vic.getByRole('button', { name: 'Filter' }).click();
  await expect(vic.locator('main tbody tr', { hasText: 'Withdrawn' }).first()).toBeVisible();

  // Nobody can change their own access: Lucy's own row has no form.
  await lucy.goto('/admin?tab=users');
  await expect(lucy.locator('main tr', { hasText: 'Lucy Parkin' })).toContainText('You');
  await expect(lucy.locator('main tr', { hasText: 'Lucy Parkin' }).getByText('Change access')).toHaveCount(0);
});

test('8 · Fraser (auditor) verifies the audit chain; any change is refused', async ({ browser }) => {
  const fraser = await signIn(browser, 'fraser');
  await fraser.goto('/admin?tab=audit');
  await fraser.getByRole('link', { name: 'Verify the chain' }).click();
  await expect(fraser.getByRole('status')).toContainText('Chain verified.');

  // Read-only: no create button, and the API refuses any change even when called directly. This uses the
  // development sign-in header, so it only runs against a local stack (E2E_API_URL, default http://localhost:8080).
  await fraser.goto('/documents');
  await expect(fraser.getByRole('link', { name: /New document/i })).toHaveCount(0);
  const api = process.env.E2E_API_URL ?? 'http://localhost:8080';
  const asFraser = { 'x-dev-user': 'dev-aud' };
  const attempts = [
    fraser.request.post(`${api}/api/v1/documents`, { headers: asFraser, data: { docType: 'Policy', title: 'Auditor test', classification: 'Internal' } }),
    fraser.request.put(`${api}/api/v1/settings`, { headers: asFraser, data: { docusignAllowance: 1 } }),
    fraser.request.post(`${api}/api/v1/training/reminders`, { headers: asFraser })
  ];
  for (const r of await Promise.all(attempts)) {
    expect(r.status()).toBe(403);
    expect((await r.json()).error.message).toMatch(/read-only/);
  }
});

test('9 · Every report exports as Excel and PDF, stamped and logged', async ({ browser }) => {
  const vic = await signIn(browser, 'victoria');
  const reports = ['training-matrix', 'training-records', 'document-status?documentNumber=SOP-012', 'approvals-register', 'docusign-sends'];
  for (const rep of reports) {
    const [name, query] = rep.split('?');
    for (const format of ['pdf', 'xlsx'] as const) {
      const res = await vic.request.get(`/reports/${name}.${format}${query ? `?${query}` : ''}`);
      expect(res.status(), `${name}.${format}`).toBe(200);
      const body = await res.body();
      expect(body.subarray(0, 4).toString('latin1'), `${name}.${format} file signature`).toBe(format === 'pdf' ? '%PDF' : 'PK\u0003\u0004');
      expect(res.headers()['content-disposition'] ?? '', `${name}.${format} downloads as a file`).toContain('attachment');
    }
  }
  await vic.goto('/admin?tab=audit&objectType=Report');
  await expect(vic.locator('main tbody tr', { hasText: 'Exported' })).toHaveCount(reports.length * 2);
});
