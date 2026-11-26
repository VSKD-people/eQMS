// Starts the API. In Azure the database password is a short-lived Entra ID token for the API's managed identity.
import { createPool, type Pool } from '@veqms/db';
import { loadConfig, type Config } from './config.ts';
import { buildApp } from './app.ts';
import { createAdobeSign } from './integrations/adobesign.ts';
import { createStorage } from './integrations/storage.ts';
import { createSharePoint } from './integrations/sharepoint.ts';
import { createInboxWorker } from './services/inbox.ts';
import { createPublisher } from './services/sharepoint.ts';

// Scope for Azure Database for PostgreSQL with Entra authentication. Check it against Microsoft's current docs.
const PG_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';

export async function poolFor(cfg: Config, onError?: (err: Error) => void): Promise<Pool> {
  if (!cfg.DATABASE_ENTRA_AUTH) return createPool({ connectionString: cfg.DATABASE_URL, ssl: cfg.DATABASE_SSL, onError });
  const { DefaultAzureCredential } = await import('@azure/identity');
  const cred = new DefaultAzureCredential();
  // node-postgres calls this for each new connection, so tokens are refreshed as connections are replaced.
  return createPool({ connectionString: cfg.DATABASE_URL, ssl: true, onError, password: async () => {
    const t = await cred.getToken(PG_SCOPE);
    if (!t) throw new Error('No Entra ID token for the database. Check the managed identity.');
    return t.token;
  } });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  // The pool exists before the app's logger, so idle-connection errors go through `log` once the app is built.
  let log: { error: (obj: object, msg: string) => void } = { error: (obj, msg) => console.error(msg, obj) };
  // Log the message and code only: pg errors carry the whole client object, which is large and holds connection details.
  const pool = await poolFor(cfg, (err) => log.error({ err: { message: err.message, code: (err as { code?: string }).code } }, 'Database connection lost; it will be replaced on the next request'));
  const esign = createAdobeSign(cfg), storage = createStorage(cfg), sharepoint = createSharePoint(cfg);
  const inbox = createInboxWorker(pool, { esign, storage }, { error: (obj, msg) => log.error(obj, msg) });
  const publisher = createPublisher(pool, { sharepoint, storage }, cfg.ENTRA_TENANT_ID, { error: (obj, msg) => log.error(obj, msg) });
  const app = buildApp({ cfg, pool, esign, storage, sharepoint, inbox, publisher });
  log = app.log;
  inbox.start();
  inbox.kick(); // anything queued before a restart
  publisher.start();
  publisher.kick();
  if (cfg.devAuthAllowed) app.log.warn('Development sign-in (X-Dev-User) is ON. Never use this setting in production.');
  if (cfg.stage === 'staging') app.log.warn('STAGING: a test environment. Do not put real quality records here.');
  if (cfg.ADOBE_SIGN_MODE === 'mock') app.log.warn('Adobe Sign is in MOCK mode: nothing is sent to Adobe Sign and signatures are simulated.');
  if (cfg.SHAREPOINT_MODE === 'mock') app.log.warn('SharePoint is in MOCK mode: both libraries are a local folder, lost when the container restarts.');
  const stop = async () => { inbox.stop(); publisher.stop(); await app.close(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
