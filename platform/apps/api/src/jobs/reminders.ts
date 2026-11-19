// Daily job (06:00 UTC in Azure): for every tenant, training reminders and overdue notices, a status check on
// envelopes that have been out for more than a day (in case a Connect message was missed), and the email queue.
import { withTenant } from '@veqms/db';
import { loadConfig } from '../config.ts';
import { createDocuSign } from '../integrations/docusign.ts';
import { createStorage } from '../integrations/storage.ts';
import { poolFor } from '../server.ts';
import { sendQueuedEmail } from '../integrations/mail.ts';
import * as env from '../services/envelopes.ts';
import { reminders } from '../services/training.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = await poolFor(cfg);
  const deps = { docusign: createDocuSign(cfg), storage: createStorage(cfg) };
  let failed = 0;
  try {
    const tenants = (await pool.query<{ tenant_id: string }>('select distinct tenant_id from app.tenant_directory')).rows;
    for (const t of tenants) {
      try {
        const r = await withTenant(pool, { tenantId: t.tenant_id, userId: null }, (db) => reminders(db));
        console.log(JSON.stringify({ tenant: t.tenant_id, job: 'training-reminders', ...r }));
        if (deps.docusign.mode === 'live') {
          const stale = await withTenant(pool, { tenantId: t.tenant_id, userId: null }, (db) => env.staleEnvelopes(db, 24));
          for (const id of stale) {
            // One transaction per envelope, so one failure doesn't hold back the rest.
            await withTenant(pool, { tenantId: t.tenant_id, userId: null }, (db) => env.fromDocuSign(db, deps, id, 'poll'))
              .catch((e) => { failed++; console.error(JSON.stringify({ tenant: t.tenant_id, job: 'envelope-poll', envelope: id, error: String(e) })); });
          }
          console.log(JSON.stringify({ tenant: t.tenant_id, job: 'envelope-poll', checked: stale.length }));
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
