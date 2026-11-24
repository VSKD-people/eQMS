// The Phase 1 UAT scenarios from docs/07-testing-and-validation.md, driven through the web app as each persona.
// Adobe Sign runs in mock mode: each signer signs on the record page when it is their turn.
// Run once, in order, against a freshly seeded database. Scenarios touch different records, so one failing
// doesn't stop the others.
import { test, expect } from '@playwright/test';
import { signIn, expectOk, expectRefused, mockSign, mockDecline, verifyAndSend, expectDocState, checkPdfAndSubmit, markReviewed, approveDoc } from './helpers';

test('1 · Victoria cannot submit POL-003 she wrote with herself as QA approver: not offered, refused by the API and logged', async ({ browser }) => {
  const vic = await signIn(browser, 'victoria');
  await vic.goto('/documents/POL-003/submit');
  await expect(vic.locator('#a1 option', { hasText: 'Victoria' })).toHaveCount(0);

  // The API checks again even if the browser is bypassed: put her back in the list and post the form anyway.
  await vic.goto('/documents/POL-003?tab=training');
  await vic.getByText('Change audience').click();
  await vic.getByText(/Named people/).click();
  const vicId = await vic.getByLabel(/Victoria/).getAttribute('value');
  await vic.goto('/documents/POL-003/submit');
  await vic.locator('#a1').evaluate((s, id) => { const o = document.createElement('option'); o.value = id!; o.text = 'Victoria'; s.appendChild(o); (s as HTMLSelectElement).value = id!; }, vicId);
  await vic.getByRole('button', { name: 'Make the PDF' }).click();
  await expectRefused(vic, /segregation of duties/i);

  // The refusal reached the audit trail even though the request rolled back.
  await vic.goto('/admin?tab=audit&objectId=POL-003');
  await expect(vic.locator('main tbody tr', { hasText: /Submit refused: .*segregation of duties/i })).toHaveCount(1);
});

test('2 · VP-001: Carrie checks the locked PDF and submits, Omar reviews, Victoria approves, the agreement goes out, all sign, Effective', async ({ browser }) => {
  const carrie = await signIn(browser, 'carrie');
  await carrie.goto('/documents/VP-001/submit');
  await carrie.getByRole('button', { name: 'Make the PDF' }).click();
  await expectOk(carrie, 'PDF made and locked');
  await checkPdfAndSubmit(carrie, 'VP-001');
  await expectDocState(carrie, 'VP-001', 'In review');

  const omar = await signIn(browser, 'omar');
  await markReviewed(omar, 'VP-001');
  await expectDocState(omar, 'VP-001', 'In approval');

  // Victoria is the only QA approver: her approval sends the agreement to Adobe Sign at once.
  const vic = await signIn(browser, 'victoria');
  await approveDoc(vic, 'VP-001');
  await expectDocState(vic, 'VP-001', 'Signing');
  // She has no Sign button until the author and reviewer have signed.
  await expect(vic.getByRole('button', { name: /^Sign \(/ })).toHaveCount(0);

  await mockSign(carrie, '/documents/VP-001', 'Authored');
  await mockSign(omar, '/documents/VP-001', 'Reviewed');
  await mockSign(vic, '/documents/VP-001', 'Approved');
  await expectDocState(vic, 'VP-001', 'Effective');
  await expect(vic.locator('.ctx-card').first()).toContainText('CR-019 · Closed');

  // Signing the agreement counts as training for the author and reviewer.
  await vic.goto('/documents/VP-001?tab=training');
  for (const name of ['Carrie Foreman', 'Omar Haddad']) {
    await expect(vic.locator('main tr', { hasText: name })).toContainText('Complete');
  }
  // The IT team (here Jim) now has VP-001 to read.
  const jim = await signIn(browser, 'jim');
  await jim.goto('/training');
  await expect(jim.locator('main')).toContainText('VP-001');
});

test('3 · POL-004: cancel, resubmit, PJ returns it, resubmit, both approve (no retraining), corrected send, decline back to draft', async ({ browser }) => {
  const jim = await signIn(browser, 'jim');
  await jim.goto('/documents/POL-004?tab=approval');
  await jim.getByText('Cancel this agreement').click();
  await jim.getByLabel('Reason (required)').fill('Section 4 still names the old leaver process.');
  await jim.getByRole('button', { name: 'Cancel agreement' }).click();
  await expectOk(jim, 'Agreement cancelled');
  await expectDocState(jim, 'POL-004', 'Draft');

  // Resubmit with Carrie as the only reviewer (Victoria and PJ stay the QA approvers).
  await jim.goto('/documents/POL-004/submit');
  const reviewers = jim.getByRole('group', { name: /Reviewers/ });
  for (const c of await reviewers.getByRole('checkbox').all()) await c.uncheck();
  await reviewers.getByLabel(/Carrie Foreman/).check();
  await jim.getByRole('button', { name: 'Make the PDF' }).click();
  await expectOk(jim, 'PDF made and locked');
  await checkPdfAndSubmit(jim, 'POL-004');

  const carrie = await signIn(browser, 'carrie');
  await markReviewed(carrie, 'POL-004');
  await expectDocState(carrie, 'POL-004', 'In approval');

  // PJ returns it to the author from approval.
  const pj = await signIn(browser, 'pj');
  await pj.goto('/documents/POL-004');
  await pj.getByText('Return to the author', { exact: true }).first().click();
  await pj.getByLabel('Reason (required)').fill('Clause 4 needs the 60-minute rule for leavers.');
  await pj.getByRole('button', { name: 'Return to the author' }).click();
  await expectOk(pj, 'Returned to the author');
  await expectDocState(pj, 'POL-004', 'Draft');

  // The locked PDF is unchanged, so Jim checks it again and resubmits.
  await jim.goto('/documents/POL-004/submit');
  await checkPdfAndSubmit(jim, 'POL-004');
  await markReviewed(carrie, 'POL-004');
  const vic = await signIn(browser, 'victoria');
  await approveDoc(vic, 'POL-004', 'Clarifies the existing rules; what staff do is unchanged.');
  await expectDocState(vic, 'POL-004', 'In approval');
  await approveDoc(pj, 'POL-004', 'Wording only; no new steps for staff.');
  await expectDocState(pj, 'POL-004', 'Signing');

  // The corrected agreement is a new transaction, linked to the cancelled one.
  await jim.goto('/documents/POL-004?tab=approval');
  await expect(jim.locator('main')).toContainText('Correction');

  await mockSign(jim, '/documents/POL-004', 'Authored');
  await mockDecline(carrie, '/documents/POL-004', 'The access review frequency contradicts SOP-018.');
  await expectDocState(jim, 'POL-004', 'Draft');
});

test('4 · Daniel opens SOP-012, confirms with the quiz; a correction leaves the original marked Corrected', async ({ browser }) => {
  const daniel = await signIn(browser, 'daniel');
  await daniel.goto('/training');
  await daniel.locator('main div', { has: daniel.getByText(/^SOP-012 Backup and Restore Procedure/) }).getByRole('link', { name: 'Start' }).first().click();
  await expect(daniel).toHaveURL(/\/training\/[0-9a-f-]{36}$/);
  const recordUrl = daniel.url();
  // He must open the PDF of the version before he can confirm; VeQMS records the open.
  await expect(daniel.getByRole('status').filter({ hasText: 'Open the PDF of v3.0 first' })).toBeVisible();
  // The PDF opens in a new tab; wait for its response (that request is what logs the open), not for the tab to load.
  const [pdf] = await Promise.all([
    daniel.waitForEvent('popup'),
    daniel.context().waitForEvent('response', (r) => /\/files\/documents\/SOP-012\/pdf/.test(r.url()) && r.status() === 200),
    daniel.getByRole('link', { name: /Open PDF of v3\.0/ }).click()
  ]);
  await pdf.close();
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
  await expectOk(carrie, 'Closure sent to Adobe Sign');

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
  await expectOk(louise, 'Closure sent to Adobe Sign');
  await mockSign(louise, '/quality/events/QE-017', 'Authored');

  const vic = await signIn(browser, 'victoria');
  await mockDecline(vic, '/quality/events/QE-017', 'Add the date the Q4 test ran so the justification can be checked.');

  await louise.goto('/quality/events/QE-017');
  await verifyAndSend(louise);
  await expectOk(louise, 'Closure sent to Adobe Sign');
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
    fraser.request.put(`${api}/api/v1/settings`, { headers: asFraser, data: { signingAllowance: 1 } }),
    fraser.request.post(`${api}/api/v1/training/reminders`, { headers: asFraser })
  ];
  for (const r of await Promise.all(attempts)) {
    expect(r.status()).toBe(403);
    expect((await r.json()).error.message).toMatch(/read-only/);
  }
});

test('9 · Every report exports as Excel and PDF, stamped and logged', async ({ browser }) => {
  const vic = await signIn(browser, 'victoria');
  const reports = ['training-matrix', 'training-records', 'document-status?documentNumber=SOP-012', 'approvals-register', 'signing-transactions'];
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
