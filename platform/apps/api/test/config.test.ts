// Configuration rules for each stage: development may simulate everything; staging (VEQMS_STAGE=staging under
// NODE_ENV=production) may keep Adobe Sign and SharePoint as placeholders but needs real Entra sign-in; production
// needs Adobe Sign and SharePoint live. No database needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.ts';

const base = { DATABASE_URL: 'postgres://x', ENTRA_TENANT_ID: 't', ENTRA_API_AUDIENCE: 'a' };
const liveSharePoint = { SHAREPOINT_MODE: 'live', SHAREPOINT_SITE_ID: 's', SHAREPOINT_DRAFTS_DRIVE_ID: 'd', SHAREPOINT_CONTROLLED_DRIVE_ID: 'c', SHAREPOINT_APP_ID: 'app' };
const liveAdobe = { ADOBE_SIGN_MODE: 'live', ADOBE_SIGN_AUTH: 'integration-key', ADOBE_SIGN_INTEGRATION_KEY: 'k', ADOBE_SIGN_WEBHOOK_TOKEN: 'x'.repeat(40) };

test('config: stages', () => {
  assert.equal(loadConfig({ DATABASE_URL: 'postgres://x' }).stage, 'development', 'no NODE_ENV: development, mocks allowed');

  const staging = loadConfig({ ...base, NODE_ENV: 'production', VEQMS_STAGE: 'staging' });
  assert.equal(staging.stage, 'staging');
  assert.equal(staging.ADOBE_SIGN_MODE, 'mock', 'staging may keep Adobe Sign as a placeholder');
  assert.equal(staging.SHAREPOINT_MODE, 'mock', 'staging may keep SharePoint as a placeholder');
  assert.equal(staging.devAuthAllowed, false);
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', VEQMS_STAGE: 'staging', DEV_AUTH: '1' }), /DEV_AUTH/, 'staging still needs real sign-in');
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://x', NODE_ENV: 'production', VEQMS_STAGE: 'staging' }), /ENTRA_TENANT_ID/, 'staging still needs Entra');

  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), /ADOBE_SIGN_MODE must be live/, 'production refuses simulated signatures');
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', VEQMS_STAGE: 'production', ...liveAdobe }), /SHAREPOINT_MODE must be live/, 'production refuses simulated SharePoint');
  const prod = loadConfig({ ...base, NODE_ENV: 'production', ...liveAdobe, ...liveSharePoint });
  assert.equal(prod.stage, 'production', 'NODE_ENV=production without VEQMS_STAGE is production');
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', VEQMS_STAGE: 'test' as any }), /VEQMS_STAGE|Invalid/, 'an unknown stage is refused');
  console.log('  ✓ config stages: 10 checks');
});
