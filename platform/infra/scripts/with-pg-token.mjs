#!/usr/bin/env node
// Runs a command with an Entra ID access token for Azure Database for PostgreSQL in PGPASSWORD.
// Used by the migrate and reminders jobs: node-postgres reads PGPASSWORD when the connection string has no password.
// Only acts when DATABASE_ENTRA_AUTH=1; otherwise it simply runs the command (local development).
// Token request: the Container Apps managed identity endpoint (IDENTITY_ENDPOINT / IDENTITY_HEADER). Check the
// endpoint, api-version and resource against Microsoft's current Container Apps managed identity docs.
import { spawn } from 'node:child_process';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: with-pg-token.mjs <command> [args...]');
  process.exit(2);
}
const env = { ...process.env };

if (env.DATABASE_ENTRA_AUTH === '1') {
  const endpoint = env.IDENTITY_ENDPOINT;
  const header = env.IDENTITY_HEADER;
  if (!endpoint || !header) {
    console.error('DATABASE_ENTRA_AUTH=1 but no managed identity endpoint is available (IDENTITY_ENDPOINT / IDENTITY_HEADER).');
    process.exit(1);
  }
  const url = new URL(endpoint);
  url.searchParams.set('resource', 'https://ossrdbms-aad.database.windows.net');
  url.searchParams.set('api-version', '2019-08-01');
  if (env.AZURE_CLIENT_ID) url.searchParams.set('client_id', env.AZURE_CLIENT_ID);
  const res = await fetch(url, { headers: { 'X-IDENTITY-HEADER': header } });
  if (!res.ok) {
    console.error(`Token request failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  if (!body.access_token) {
    console.error('Token response had no access_token.');
    process.exit(1);
  }
  env.PGPASSWORD = body.access_token;
}

const child = spawn(cmd, args, { stdio: 'inherit', env });
child.on('error', (e) => { console.error(e.message); process.exit(1); });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
