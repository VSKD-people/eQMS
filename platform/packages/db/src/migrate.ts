// Applies SQL migrations in name order, each in its own transaction, and records them in app.schema_migrations.
// Run as the migration owner (Azure: the server's Entra admin or admin login), never as the API role.
//   DATABASE_URL=postgres://... node dist/migrate.js
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));

export async function migrate(connectionString: string, dir = join(here, '..', 'migrations'), log = console.log): Promise<string[]> {
  const client = new pg.Client({ connectionString, application_name: 'veqms-migrate' });
  await client.connect();
  const applied: string[] = [];
  try {
    const exists = await client.query("select to_regclass('app.schema_migrations') as t");
    const done = new Set<string>();
    if (exists.rows[0]?.t) for (const r of (await client.query('select name from app.schema_migrations')).rows) done.add(r.name as string);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into app.schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file); log(`applied ${file}`);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
    if (!applied.length) log('database is up to date');
    return applied;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Set DATABASE_URL'); process.exit(1); }
  migrate(url).catch((e) => { console.error(e.message); process.exit(1); });
}
