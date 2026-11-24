import 'server-only';

// Server-side configuration. Read lazily so `next build` works without secrets.
function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  get apiBaseUrl() { return need('API_BASE_URL').replace(/\/$/, ''); },
  get appBaseUrl() { return need('APP_BASE_URL').replace(/\/$/, ''); },
  get tenantId() { return need('ENTRA_TENANT_ID'); },
  get clientId() { return need('ENTRA_WEB_CLIENT_ID'); },
  get clientSecret() { return need('ENTRA_WEB_CLIENT_SECRET'); },
  get apiScope() { return need('ENTRA_API_SCOPE'); },
  get sessionSecret() { return need('SESSION_SECRET'); },
  // VEQMS_LOCAL=1 marks the local Docker stack, where the standalone Next.js server always runs with
  // NODE_ENV=production. Never set it in Azure. The API is the real gate: it refuses development sign-in whenever
  // its own NODE_ENV is production.
  get local() { return process.env.VEQMS_LOCAL === '1'; },
  // The persona picker is only ever available outside production (or on the local Docker stack).
  get devAuth() { return process.env.DEV_AUTH === '1' && (process.env.NODE_ENV !== 'production' || this.local); },
  get production() { return process.env.NODE_ENV === 'production' && !this.local; }
};
