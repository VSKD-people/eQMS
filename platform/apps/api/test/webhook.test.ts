// The Adobe Sign webhook route, through Fastify's request injection with the API in live mode and a faked Adobe Sign
// client (nothing leaves the machine). Checks the secret URL, the client ID check, the echo Adobe Sign requires, and
// that a notification only records its arrival and asks Adobe Sign for the status (the fake answers "nothing new").
// Needs a migrated and seeded database (it only adds one agreement event). Skipped when DATABASE_URL is not set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPool, withTenant, rows } from '@veqms/db';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';

const TOKEN = 'test-webhook-token-0123456789abcdef0123456789';
const CLIENT = 'test-client-id';

test('Adobe Sign webhook: secret URL, client ID, echo, and status read from Adobe Sign', { skip: process.env.DATABASE_URL ? false : 'set DATABASE_URL to a seeded database' }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c role=veqms_app');
  const pool = createPool({ connectionString: url.toString() });
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), ADOBE_SIGN_MODE: 'live', ADOBE_SIGN_AUTH: 'integration-key', ADOBE_SIGN_INTEGRATION_KEY: 'unused',
    ADOBE_SIGN_WEBHOOK_TOKEN: TOKEN, ADOBE_SIGN_WEBHOOK_CLIENT_ID: CLIENT });
  let asked = 0;
  const esign = { mode: 'live' as const, createAgreement: async () => 'x', cancelAgreement: async () => {}, getState: async () => { asked++; return null; },
    downloadSigned: async () => null, downloadAuditReport: async () => null, checkSignIn: async () => {} };
  const storage = { put: async () => {}, get: async () => new Uint8Array() };
  const app = buildApp({ cfg, pool, esign, storage: storage as any });
  try {
    const path = `/webhooks/adobe-sign/${TOKEN}`;
    const hdr = { 'x-adobesign-clientid': CLIENT };

    const wrongToken = await app.inject({ method: 'GET', url: '/webhooks/adobe-sign/not-the-token', headers: hdr });
    assert.equal(wrongToken.statusCode, 404, 'wrong token: plain 404');
    const wrongClient = await app.inject({ method: 'GET', url: path, headers: { 'x-adobesign-clientid': 'someone-else' } });
    assert.equal(wrongClient.statusCode, 404, 'wrong client ID: plain 404');

    const intent = await app.inject({ method: 'GET', url: path, headers: hdr });
    assert.equal(intent.statusCode, 200, 'verification of intent accepted');
    assert.equal(intent.headers['x-adobesign-clientid'], CLIENT, 'client ID echoed in the header');
    assert.deepEqual(intent.json(), { xAdobeSignClientId: CLIENT }, 'client ID echoed in the body');

    const unknown = await app.inject({ method: 'POST', url: path, headers: { ...hdr, 'content-type': 'application/json' }, payload: JSON.stringify({ event: 'AGREEMENT_ACTION_COMPLETED', agreement: { id: 'no-such-agreement' } }) });
    assert.equal(unknown.statusCode, 200);
    assert.equal(unknown.json().ignored, 'unknown agreement', 'unknown agreement: acknowledged and ignored');

    const known = await app.inject({ method: 'POST', url: path, headers: { ...hdr, 'content-type': 'application/json' }, payload: JSON.stringify({ event: 'AGREEMENT_ACTION_COMPLETED', agreement: { id: 'demo-env:POL-004' } }) });
    assert.equal(known.statusCode, 200);
    assert.equal(known.headers['x-adobesign-clientid'], CLIENT);
    assert.equal(asked, 1, 'the API asked Adobe Sign for the status instead of trusting the notification');
    const tenant = (await pool.query('select tenant_id from app.agreement_directory where provider_agreement_id = $1', ['demo-env:POL-004'])).rows[0].tenant_id;
    const ev = await withTenant(pool, { tenantId: tenant, userId: null }, (db) => rows<{ source: string; payload_sha256: string | null }>(db,
      `select e.source, e.payload_sha256 from app.agreement_events e join app.agreements a on a.id = e.agreement_id where a.provider_agreement_id = 'demo-env:POL-004' and e.source = 'webhook' and e.payload_sha256 is not null`));
    assert.ok(ev.length >= 1, 'the notification is recorded with the hash of its payload');
    console.log('  ✓ webhook route: 7 checks');
  } finally {
    await app.close();
    await pool.end();
  }
});
