// Starts the API. In Azure the database password is a short-lived Entra ID token for the API's managed identity.
import { createPool, type Pool } from '@veqms/db';
import { loadConfig, type Config } from './config.ts';
import { buildApp } from './app.ts';
import { createDocuSign } from './integrations/docusign.ts';
import { createStorage } from './integrations/storage.ts';

// Scope for Azure Database for PostgreSQL with Entra authentication. Check it against Microsoft's current docs.
const PG_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

export async function poolFor(cfg: Config): Promise<Pool> {
  if (!cfg.DATABASE_ENTRA_AUTH) return createPool({ connectionString: cfg.DATABASE_URL, ssl: cfg.DATABASE_SSL });
  const { DefaultAzureCredential } = await import('@azure/identity');
  const cred = new DefaultAzureCredential();
  // node-postgres calls this for each new connection, so tokens are refreshed as connections are replaced.
  return createPool({ connectionString: cfg.DATABASE_URL, ssl: true, password: async () => {
    const t = await cred.getToken(PG_SCOPE);
    if (!t) throw new Error('No Entra ID token for the database. Check the managed identity.');
    return t.token;
  } });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = await poolFor(cfg);
  const app = buildApp({ cfg, pool, docusign: createDocuSign(cfg), storage: createStorage(cfg) });
  if (cfg.devAuthAllowed) app.log.warn('Development sign-in (X-Dev-User) is ON. Never use this setting in production.');
  if (cfg.DOCUSIGN_MODE === 'mock') app.log.warn('DocuSign is in MOCK mode: nothing is sent to DocuSign and signatures are simulated.');
  const stop = async () => { await app.close(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
