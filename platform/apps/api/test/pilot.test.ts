// Pilot placeholders against a migrated database, as the API's role: files kept in the database (write-once), and
// SharePoint switched off (nothing published or synced; Effective versions wait). Skipped without DATABASE_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPool, withTenant } from '@veqms/db';
import { loadConfig } from '../src/config.ts';
import { createStorage } from '../src/integrations/storage.ts';
import { createSharePoint } from '../src/integrations/sharepoint.ts';
import { publishPending, runSync } from '../src/services/sharepoint.ts';

test('pilot placeholders: files in the database, SharePoint off', { skip: process.env.DATABASE_URL ? false : 'set DATABASE_URL to a migrated database' }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c role=veqms_app');
  const pool = createPool({ connectionString: url.toString() });
  const cfg = loadConfig({ DATABASE_URL: url.toString(), STORAGE_MODE: 'database', SHAREPOINT_MODE: 'off' });
  let n = 0;
  const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
  try {
    const storage = createStorage(cfg, pool);
    const key = `test/${randomUUID()}/locked.pdf`;
    const bytes = new Uint8Array(Buffer.from('%PDF-1.7 pilot test'));
    await storage.put(key, bytes, 'application/pdf');
    ok(Buffer.from(await storage.get(key)).equals(Buffer.from(bytes)), 'a file stored in the database reads back byte for byte');
    await assert.rejects(storage.put(key, new Uint8Array([1]), 'application/pdf'), /already exists/); n++;
    await assert.rejects(storage.get('test/missing.pdf'), /not found/); n++;
    await assert.rejects(pool.query('update app.file_store set bytes = $2 where key = $1', [key, Buffer.from('x')]), /permission denied|insert-only/); n++;
    ok(true, 'write-once: no overwrite, no update; a missing key says so');

    const sp = createSharePoint(cfg);
    ok(sp.mode === 'off', 'SharePoint off');
    const tenant = (await pool.query('select tenant_id from app.tenant_directory limit 1')).rows[0]?.tenant_id;
    if (tenant) {
      const r = await withTenant(pool, { tenantId: tenant, userId: null }, (db) => publishPending(db, { sharepoint: sp, storage }));
      ok(r.published === 0 && r.failed === 0, 'nothing is published while SharePoint is off (versions keep waiting)');
      await assert.rejects(withTenant(pool, { tenantId: tenant, userId: null }, (db) => runSync(db, { sharepoint: sp, storage })), /isn’t connected/); n++;
    }
    await assert.rejects(sp.download('controlled', 'x'), /isn’t connected/); n++;
    console.log(`  ✓ pilot placeholders: ${n} checks`);
  } finally {
    await pool.end();
  }
});
