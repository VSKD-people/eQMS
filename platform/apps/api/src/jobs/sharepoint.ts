// SharePoint job (Azure: veqms-sharepoint, every 15 minutes by default; Bicep parameter sharePointSyncCron). For every
// tenant: publish Effective versions still waiting, then the delta sync of the Drafts and controlled libraries (changes
// made outside VeQMS in the controlled library raise integrity alerts). A failed sync resumes from the last good token.
import { withTenant } from '@veqms/db';
import { loadConfig } from '../config.ts';
import { createSharePoint } from '../integrations/sharepoint.ts';
import { createStorage } from '../integrations/storage.ts';
import { poolFor } from '../server.ts';
import { runSync, sharePointTenants } from '../services/sharepoint.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = await poolFor(cfg);
  const deps = { sharepoint: createSharePoint(cfg), storage: createStorage(cfg) };
  if (deps.sharepoint.mode === 'mock') {
    // Mock SharePoint is a folder inside the API's own container, which this job can't see. The API publishes to it
    // itself; there is nothing for the job to sync (staging and development).
    console.log(JSON.stringify({ job: 'sharepoint', skipped: 'SharePoint is in mock mode' }));
    await pool.end();
    process.exit(0);
  }
  let failed = 0;
  try {
    for (const t of await sharePointTenants(pool, cfg.ENTRA_TENANT_ID)) {
      try {
        const r = await withTenant(pool, { tenantId: t, userId: null }, (db) => runSync(db, deps));
        if (r.drafts.outcome === 'failed' || r.controlled.outcome === 'failed') failed++;
        console.log(JSON.stringify({ tenant: t, job: 'sharepoint', ...r }));
      } catch (e) {
        failed++;
        console.error(JSON.stringify({ tenant: t, job: 'sharepoint', error: String(e) }));
      }
    }
  } finally {
    await pool.end();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
