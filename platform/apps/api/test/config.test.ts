// Configuration rules for each mode, no database needed.
//   development: anything may be simulated.
//   pilot (NODE_ENV=production, VEQMS_MODE=pilot): placeholders allowed (local sign-in, simulated signatures,
//     SharePoint off, files in the database); never the development persona sign-in.
//   production (NODE_ENV=production): Microsoft sign-in, Adobe Sign, SharePoint and Azure storage, all live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

const secret = 'x'.repeat(40);
const pilot = { DATABASE_URL: 'postgres://x', NODE_ENV: 'production', VEQMS_MODE: 'pilot', AUTH_MODE: 'local', LOCAL_AUTH_SECRET: secret, SHAREPOINT_MODE: 'off', STORAGE_MODE: 'database' };
const live = { DATABASE_URL: 'postgres://x', NODE_ENV: 'production', ENTRA_TENANT_ID: 't', ENTRA_API_AUDIENCE: 'a', ADOBE_SIGN_MODE: 'live', ADOBE_SIGN_AUTH: 'integration-key',
  ADOBE_SIGN_INTEGRATION_KEY: 'k', ADOBE_SIGN_WEBHOOK_TOKEN: secret, SHAREPOINT_MODE: 'live', SHAREPOINT_SITE_ID: 's', SHAREPOINT_DRAFTS_DRIVE_ID: 'd',
  SHAREPOINT_CONTROLLED_DRIVE_ID: 'c', SHAREPOINT_APP_ID: 'app', STORAGE_MODE: 'azure', STORAGE_ACCOUNT_URL: 'https://x' };

test('config: development, pilot and production', () => {
  let n = 0;
  const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
  const refuses = (env: Record<string, string>, re: RegExp, m: string) => { assert.throws(() => loadConfig(env), re, m); n++; };

  ok(loadConfig({ DATABASE_URL: 'postgres://x' }).mode === 'development', 'no NODE_ENV: development');
  const p = loadConfig(pilot);
  ok(p.mode === 'pilot' && p.AUTH_MODE === 'local' && p.ADOBE_SIGN_MODE === 'mock' && p.SHAREPOINT_MODE === 'off' && p.STORAGE_MODE === 'database', 'pilot runs with every placeholder');
  ok(!p.devAuthAllowed, 'pilot never allows the development sign-in');
  refuses({ ...pilot, DEV_AUTH: '1' }, /DEV_AUTH/, 'pilot refuses DEV_AUTH');
  refuses({ ...pilot, LOCAL_AUTH_SECRET: 'short' }, /LOCAL_AUTH_SECRET/, 'local sign-in needs a long secret');
  refuses({ ...pilot, AUTH_MODE: 'entra' }, /ENTRA_TENANT_ID/, 'Microsoft sign-in in pilot needs its settings');
  ok(loadConfig({ ...pilot, AUTH_MODE: 'entra', ENTRA_TENANT_ID: 't', ENTRA_API_AUDIENCE: 'a' }).AUTH_MODE === 'entra', 'pilot can switch to Microsoft sign-in on its own');

  ok(loadConfig(live).mode === 'production', 'NODE_ENV=production without VEQMS_MODE is production');
  refuses({ ...live, AUTH_MODE: 'local', LOCAL_AUTH_SECRET: secret }, /AUTH_MODE must be entra/, 'production refuses local sign-in');
  refuses({ ...live, ADOBE_SIGN_MODE: 'mock' }, /ADOBE_SIGN_MODE must be live/, 'production refuses simulated signatures');
  refuses({ ...live, SHAREPOINT_MODE: 'off' }, /SHAREPOINT_MODE must be live/, 'production refuses SharePoint off');
  refuses({ ...live, STORAGE_MODE: 'database' }, /STORAGE_MODE must be azure/, 'production refuses database file storage');
  refuses({ ...live, VEQMS_MODE: 'test' }, /VEQMS_MODE|Invalid/, 'an unknown mode is refused');
  console.log(`  ✓ config modes: ${n} checks`);
});
