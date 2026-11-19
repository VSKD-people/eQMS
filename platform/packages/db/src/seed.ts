// Loads the demo data (development and user acceptance testing only). Refuses to run when NODE_ENV=production
// unless ALLOW_DEMO_SEED=yes is also set, so sample records never reach a live tenant by accident.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

export async function seed(connectionString: string, dir = join(here, '..', 'seed')): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'yes') throw new Error('Refusing to load demo data in production');
  const client = new pg.Client({ connectionString, application_name: 'veqms-seed' });
  await client.connect();
  try {
    const has = await client.query("select exists (select 1 from app.tenant_directory where entra_tenant_id = 'dev-tenant') as x");
    if (has.rows[0]?.x) { console.log('demo tenant already loaded'); return; }
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await client.query('begin');
      try { await client.query(readFileSync(join(dir, file), 'utf8')); await client.query('commit'); console.log(`loaded ${file}`); }
      catch (e) { await client.query('rollback'); throw e; }
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Set DATABASE_URL'); process.exit(1); }
  seed(url).catch((e) => { console.error(e.message); process.exit(1); });
}
