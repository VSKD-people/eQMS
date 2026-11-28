// Daily job (06:00 UTC in Azure): for every tenant, training reminders and overdue notices, a status check on
// agreements that have been out for more than a day (in case a webhook notification was missed), the hash check of
// every file published to the controlled SharePoint library, and the email queue.
import { one, withTenant } from '@veqms/db';
import { audit } from '../lib/work.ts';
import { loadConfig } from '../config.ts';
import { createAdobeSign } from '../integrations/adobesign.ts';
import { createStorage } from '../integrations/storage.ts';
import { createSharePoint } from '../integrations/sharepoint.ts';
import { poolFor } from '../server.ts';
import { sendQueuedEmail } from '../integrations/mail.ts';
import * as signing from '../services/agreements.ts';
import { drainInbox } from '../services/inbox.ts';
import { reminders } from '../services/training.ts';
import { hashCheck, sharePointTenants } from '../services/sharepoint.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = await poolFor(cfg);
  const deps = { esign: createAdobeSign(cfg), storage: createStorage(cfg, pool) };
  const sharepoint = createSharePoint(cfg);
  let failed = 0;
  try {
    if (deps.esign.mode === 'live') {
      await deps.esign.checkSignIn()
        .then(() => console.log(JSON.stringify({ job: 'adobe-sign-sign-in', ok: true })))
        .catch((e) => { failed++; console.error(JSON.stringify({ job: 'adobe-sign-sign-in', ok: false, error: String(e) })); });
    }
    // Webhook notifications still queued (the API normally handles them within seconds).
    const queue = await drainInbox(pool, deps, 10_000);
    console.log(JSON.stringify({ job: 'webhook-queue', ...queue }));
    const tenants = (await pool.query<{ tenant_id: string }>('select distinct tenant_id from app.tenant_directory')).rows;
    const spTenants = new Set(await sharePointTenants(pool, cfg.ENTRA_TENANT_ID));
    for (const t of tenants) {
      try {
        const r = await withTenant(pool, { tenantId: t.tenant_id, userId: null }, (db) => reminders(db));
        console.log(JSON.stringify({ tenant: t.tenant_id, job: 'training-reminders', ...r }));
        // IP address and device records past their retention (settings.client_info_retention_days). The chain covers
        // only the link to them, so it still verifies afterwards.
        const purged = await withTenant(pool, { tenantId: t.tenant_id, userId: null }, async (db) => {
          const n = (await one<{ n: number }>(db, 'select app.purge_client_info() as n')).n;
          if (n) await audit(db, 'retention', 'Audit trail', 'IP and device', `Deleted ${n} IP address and device records past their retention`);
          return n;
        });
        console.log(JSON.stringify({ tenant: t.tenant_id, job: 'client-info-retention', deleted: purged }));
        if (deps.esign.mode === 'live') {
          const stale = await withTenant(pool, { tenantId: t.tenant_id, userId: null }, (db) => signing.staleAgreements(db, 24));
          for (const id of stale) {
            // One transaction per agreement, so one failure doesn't hold back the rest.
            await withTenant(pool, { tenantId: t.tenant_id, userId: null }, (db) => signing.fromProvider(db, deps, id, 'poll'))
              .catch((e) => { failed++; console.error(JSON.stringify({ tenant: t.tenant_id, job: 'agreement-poll', agreement: id, error: String(e) })); });
          }
          console.log(JSON.stringify({ tenant: t.tenant_id, job: 'agreement-poll', checked: stale.length }));
        }
        if (spTenants.has(t.tenant_id) && sharepoint.mode === 'live') { // off: nothing published; mock: files live in the API's container
          // Every published Effective file re-hashed against its locked PDF; a mismatch or a missing file alerts QA.
          const h = await withTenant(pool, { tenantId: t.tenant_id, userId: null }, (db) => hashCheck(db, sharepoint));
          console.log(JSON.stringify({ tenant: t.tenant_id, job: 'sharepoint-hash-check', ...h }));
        }
        const mail = await sendQueuedEmail(pool, cfg, t.tenant_id);
        console.log(JSON.stringify({ tenant: t.tenant_id, job: 'email', ...mail }));
      } catch (e) {
        failed++;
        console.error(JSON.stringify({ tenant: t.tenant_id, error: String(e) }));
      }
    }
  } finally {
    await pool.end();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
