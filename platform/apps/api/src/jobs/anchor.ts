// Audit anchor job (Azure: veqms-anchor, every 15 minutes by default as Step 1 proposes; Bicep parameter auditAnchorCron). For every tenant, writes
// the audit chain head to the immutable records container if the chain has grown since the last anchor.
import { withTenant } from '@veqms/db';
import { loadConfig } from '../config.ts';
import { createStorage } from '../integrations/storage.ts';
import { poolFor } from '../server.ts';
import { anchor } from '../services/anchor.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = await poolFor(cfg);
  const storage = createStorage(cfg);
  let failed = 0;
  try {
    const tenants = (await pool.query<{ tenant_id: string }>('select distinct tenant_id from app.tenant_directory')).rows;
    for (const t of tenants) {
      try {
        const a = await withTenant(pool, { tenantId: t.tenant_id, userId: null }, (db) => anchor(db, storage));
        console.log(JSON.stringify({ tenant: t.tenant_id, job: 'audit-anchor', ...(a ? { seq: a.seq, at: a.at } : { skipped: 'no new entries' }) }));
      } catch (e) {
        failed++;
        console.error(JSON.stringify({ tenant: t.tenant_id, job: 'audit-anchor', error: String(e) }));
      }
    }
  } finally {
    await pool.end();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
