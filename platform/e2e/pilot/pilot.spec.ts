// The pilot stack in a browser (docker-compose.pilot.yml): email and password sign-in, forced password changes,
// adding a person, the pilot banner, a document from draft to Effective with simulated signatures labelled as not
// Part 11, SharePoint not connected, and a password reset ending a session.
// Run once against a fresh pilot stack after the bootstrap script, with the two printed temporary passwords:
//   PILOT_ADMIN_EMAIL=… PILOT_ADMIN_PASSWORD=… PILOT_QM_EMAIL=… PILOT_QM_PASSWORD=… npx playwright test -c playwright.pilot.config.ts
import { test, expect, type Browser, type Page } from '@playwright/test';

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Set ${k}`); return v; };
const admin = { email: env('PILOT_ADMIN_EMAIL'), temp: env('PILOT_ADMIN_PASSWORD'), password: 'ada chose a long password' };
const qm = { email: env('PILOT_QM_EMAIL'), temp: env('PILOT_QM_PASSWORD'), password: 'quinn chose a long password' };
const author = { email: 'alex.author@pilot.test', name: 'Alex Author', temp: 'alex temporary pass', password: 'alex chose a long password' };

async function signIn(browser: Browser, email: string, password: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for the sign-in to finish: it lands on the next page, or back on /login with a message.
  await page.waitForURL((u) => !u.pathname.startsWith('/login') || u.searchParams.has('err'));
  return page;
}
async function changeTemporary(page: Page, temp: string, next: string): Promise<void> {
  await expect(page).toHaveURL(/\/account\/password/);
  await expect(page.locator('main')).toContainText('You signed in with a temporary password');
  await page.getByLabel('Current password').fill(temp);
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByLabel('New password again').fill(next);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.locator('.callout.ok[role=status]')).toContainText('Password changed');
}
const ok = (page: Page, text: string | RegExp) => expect(page.locator('.callout.ok[role=status]', { hasText: text })).toBeVisible();
const docState = async (page: Page, n: string, state: string) => { await page.goto(`/documents/${n}`); await expect(page.locator('.record-meta .chip-outline')).toContainText(`· ${state}`); };

test('pilot: sign-in, people, a document to Effective with simulated signatures, SharePoint not connected, reset', async ({ browser }) => {
  // A wrong password is refused with the one message for every cause.
  const wrong = await signIn(browser, admin.email, 'not the password at all');
  await expect(wrong.locator('.callout.warn[role=alert]')).toContainText('Email or password not recognised');

  // The administrator must replace the temporary password before anything else; the pilot banner is on every page.
  const ada = await signIn(browser, admin.email, admin.temp);
  await ada.goto('/today');
  await expect(ada).toHaveURL(/\/account\/password/);
  await expect(ada.locator('[role=note]').first()).toContainText('Pilot. Test and pilot data only');
  await changeTemporary(ada, admin.temp, admin.password);
  await expect(ada.locator('[role=note]').first()).toContainText('Signatures are simulated, not Part 11');

  // The administrator adds an author with a temporary password.
  await ada.goto('/admin?tab=users');
  await ada.getByText('Add a person').click();
  await ada.getByLabel('Full name').fill(author.name);
  await ada.getByLabel('Email address').fill(author.email);
  await ada.getByLabel('Author', { exact: true }).check();
  await ada.getByLabel('All staff').check();
  await ada.getByLabel('Temporary password').fill(author.temp);
  await ada.getByRole('button', { name: 'Add person' }).click();
  await ok(ada, `${author.name} added`);

  const quinn = await signIn(browser, qm.email, qm.temp);
  await changeTemporary(quinn, qm.temp, qm.password);
  const alex = await signIn(browser, author.email, author.temp);
  await changeTemporary(alex, author.temp, author.password);

  // Alex writes a procedure in VeQMS (SharePoint isn't connected), makes the PDF, checks it and submits it.
  await alex.goto('/documents/new');
  await alex.getByLabel('Document type').selectOption('Procedure');
  await alex.getByLabel('Title').fill('Pilot laptop handover');
  await alex.getByRole('button', { name: 'Create draft' }).click();
  await expect(alex).toHaveURL(/\/documents\/SOP-\d+\/edit/);
  const number = /\/documents\/(SOP-\d+)\//.exec(alex.url())![1]!;
  await expect(alex.locator('main')).toContainText('Written in VeQMS for now');
  await alex.getByLabel('Content').fill('## 1. Purpose\n\nHand laptops over safely.\n\n## 2. Steps\n\nWipe, log, hand over.');
  await alex.getByLabel('Change summary (required)').fill('First draft');
  await alex.getByRole('button', { name: 'Save draft' }).click();
  await ok(alex, 'Draft saved');
  await alex.goto(`/documents/${number}/submit`);
  await alex.locator('#a1').selectOption({ label: 'Quinn Quality' });
  await alex.getByRole('button', { name: 'Make the PDF' }).click();
  await ok(alex, 'PDF made and locked');
  for (const c of await alex.getByRole('group', { name: /Checks/ }).getByRole('checkbox').all()) await c.check();
  await alex.getByRole('button', { name: 'Submit for review' }).click();
  await ok(alex, 'Submitted');
  await docState(alex, number, 'In approval');

  // Quinn approves; the agreement goes out at once, simulated.
  await quinn.goto(`/documents/${number}`);
  await quinn.getByRole('button', { name: 'Approve', exact: true }).click();
  await ok(quinn, 'Approved');
  await docState(quinn, number, 'Signing');
  await expect(quinn.locator('.ctx-card', { hasText: 'Simulated approval' })).toContainText('Simulated · not Part 11');

  // Each signs on the record page, in order; the version becomes Effective.
  await alex.goto(`/documents/${number}`);
  await expect(alex.locator('main')).toContainText('Sign (simulated: Adobe Sign isn’t connected)');
  await alex.getByRole('button', { name: 'Sign (Authored)' }).click();
  await ok(alex, 'Signed');
  await quinn.goto(`/documents/${number}`);
  await quinn.getByRole('button', { name: 'Sign (Approved)' }).click();
  await ok(quinn, 'Signed');
  await docState(quinn, number, 'Effective');
  await quinn.goto('/approvals');
  await expect(quinn.locator('main tr', { hasText: number }).first()).toContainText('Simulated, not Part 11');

  // SharePoint isn't connected: the Effective version waits to be published.
  await ada.goto('/admin?tab=sharepoint');
  await expect(ada.locator('main')).toContainText('SharePoint isn’t connected');
  await expect(ada.locator('main tr', { hasText: number })).toContainText('Waiting');

  // A reset ends Alex's session at once; the temporary password works and must be changed again.
  await ada.goto('/admin?tab=users');
  const row = ada.locator('main tr', { hasText: author.email });
  await row.getByText('Change access').click();
  await row.getByLabel('New temporary password').fill('alex reset password 2');
  await row.getByLabel('Reason').last().fill('Forgot password');
  await row.getByRole('button', { name: 'Reset password' }).click();
  await ok(ada, 'Password reset');
  await alex.goto('/today');
  await expect(alex).toHaveURL(/\/login/);

  // Every sign-in is in the audit trail.
  await ada.goto('/admin?tab=audit&objectType=User');
  await expect(ada.locator('main tbody tr', { hasText: 'Signed in with email and password' }).first()).toBeVisible();
  await expect(ada.locator('main tbody tr', { hasText: 'Sign-in refused' }).first()).toBeVisible();
});
