// Shared steps for the UAT browser tests: sign in as a demo persona, check the result notice, sign in mock Adobe Sign.
import { expect, type Browser, type Page } from '@playwright/test';

// Development sign-in personas from the demo seed (packages/db/seed/001_demo.sql).
export const PEOPLE = {
  victoria: 'dev-vic',
  pj: 'dev-tom',
  jim: 'dev-sam',
  carrie: 'dev-priya',
  louise: 'dev-grace',
  daniel: 'dev-daniel',
  lucy: 'dev-hannah',
  fraser: 'dev-aud',
  omar: 'dev-omar',
  jake: 'dev-jake'
} as const;
export type Who = keyof typeof PEOPLE;

// Each persona gets its own browser context, so sessions never mix.
export async function signIn(browser: Browser, who: Who): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator(`input[name=persona][value=${PEOPLE[who]}]`).check();
  await page.getByRole('button', { name: 'Continue as this persona' }).click();
  await expect(page).toHaveURL(/\/today/);
  return page;
}

// Every form posts, then lands on a page with ?ok= (green notice) or ?err= ("Not done." alert).
export async function expectOk(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator('[role=alert]', { hasText: 'Not done.' })).toHaveCount(0);
  await expect(page.locator('.callout.ok[role=status]', { hasText: text })).toBeVisible();
}
export async function expectRefused(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator('[role=alert]', { hasText: 'Not done.' })).toContainText(text);
}

// Adobe Sign mock mode: the signer whose turn it is sees a "Sign (meaning)" button on the record page.
export async function mockSign(page: Page, recordPath: string, meaning: 'Authored' | 'Reviewed' | 'Approved'): Promise<void> {
  await page.goto(recordPath);
  await page.getByRole('button', { name: `Sign (${meaning})` }).click();
  await expectOk(page, 'Signed (mock Adobe Sign)');
}
export async function mockDecline(page: Page, recordPath: string, reason: string): Promise<void> {
  await page.goto(recordPath);
  await page.getByText('Decline instead').click();
  await page.getByLabel('Reason').fill(reason);
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await expectOk(page, 'Declined (mock Adobe Sign)');
}

// The four verification ticks on every send form, then Send to Adobe Sign.
export async function verifyAndSend(page: Page): Promise<void> {
  const checks = page.getByRole('group', { name: /Verification check/ }).getByRole('checkbox');
  await expect(checks).toHaveCount(4);
  for (const c of await checks.all()) await c.check();
  await page.getByRole('button', { name: 'Send to Adobe Sign' }).click();
}

// The version chip in the record header reads "v<version> · <state>".
export async function expectDocState(page: Page, number: string, state: string): Promise<void> {
  await page.goto(`/documents/${number}`);
  await expect(page.locator('.record-meta .chip-outline')).toContainText(`· ${state}`);
}
