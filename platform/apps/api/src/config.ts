// Configuration from environment variables (Key Vault references in Azure). Fails fast on anything missing.
import { z } from 'zod';

const bool = z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  DATABASE_ENTRA_AUTH: bool,
  DATABASE_SSL: bool,
  ENTRA_TENANT_ID: z.string().default(''),
  ENTRA_API_AUDIENCE: z.string().default(''),
  DEV_AUTH: bool,
  // Adobe Sign (Adobe Acrobat Sign REST API v6). See docs/06-adobe-sign.md.
  ADOBE_SIGN_MODE: z.enum(['live', 'mock']).default('mock'),
  // oauth: an OAuth app with a refresh token (any plan). integration-key: an Enterprise integration key.
  ADOBE_SIGN_AUTH: z.enum(['oauth', 'integration-key']).default('oauth'),
  // The account's API address (its data centre), e.g. https://api.eu1.adobesign.com/. Required for oauth; with an
  // integration key it can be left empty and is discovered from ADOBE_SIGN_DISCOVERY_URL.
  ADOBE_SIGN_API_ACCESS_POINT: z.string().default(''),
  ADOBE_SIGN_DISCOVERY_URL: z.string().default('https://api.adobesign.com'),
  ADOBE_SIGN_INTEGRATION_KEY: z.string().default(''),
  ADOBE_SIGN_CLIENT_ID: z.string().default(''),
  ADOBE_SIGN_CLIENT_SECRET: z.string().default(''),
  ADOBE_SIGN_REFRESH_TOKEN: z.string().default(''),
  // Webhooks: a long random token in the webhook URL, and the client ID Adobe sends in X-AdobeSign-ClientId
  // (defaults to ADOBE_SIGN_CLIENT_ID).
  ADOBE_SIGN_WEBHOOK_TOKEN: z.string().default(''),
  ADOBE_SIGN_WEBHOOK_CLIENT_ID: z.string().default(''),
  STORAGE_MODE: z.enum(['azure', 'local']).default('local'),
  STORAGE_ACCOUNT_URL: z.string().default(''),
  STORAGE_CONTAINER: z.string().default('records'),
  LOCAL_STORAGE_DIR: z.string().default('./storage-local'),
  SCIM_TOKEN: z.string().default(''),
  GRAPH_MAIL_FROM: z.string().default(''),
  APP_BASE_URL: z.string().default('http://localhost:3000')
});

export type Config = z.infer<typeof schema> & { webhookClientId: string; devAuthAllowed: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  const production = c.NODE_ENV === 'production';
  if (production && c.DEV_AUTH) throw new Error('DEV_AUTH must not be set in production');
  if (production && c.ADOBE_SIGN_MODE !== 'live') throw new Error('ADOBE_SIGN_MODE must be live in production');
  if (production && (!c.ENTRA_TENANT_ID || !c.ENTRA_API_AUDIENCE)) throw new Error('ENTRA_TENANT_ID and ENTRA_API_AUDIENCE are required in production');
  if (c.ADOBE_SIGN_MODE === 'live') {
    if (c.ADOBE_SIGN_AUTH === 'integration-key' && !c.ADOBE_SIGN_INTEGRATION_KEY) throw new Error('Adobe Sign live mode with an integration key needs ADOBE_SIGN_INTEGRATION_KEY');
    if (c.ADOBE_SIGN_AUTH === 'oauth' && (!c.ADOBE_SIGN_CLIENT_ID || !c.ADOBE_SIGN_CLIENT_SECRET || !c.ADOBE_SIGN_REFRESH_TOKEN || !c.ADOBE_SIGN_API_ACCESS_POINT)) {
      throw new Error('Adobe Sign live mode with OAuth needs ADOBE_SIGN_CLIENT_ID, ADOBE_SIGN_CLIENT_SECRET, ADOBE_SIGN_REFRESH_TOKEN and ADOBE_SIGN_API_ACCESS_POINT');
    }
    if (c.ADOBE_SIGN_WEBHOOK_TOKEN.length < 32) throw new Error('Adobe Sign live mode needs ADOBE_SIGN_WEBHOOK_TOKEN of at least 32 random characters');
  }
  return { ...c, webhookClientId: c.ADOBE_SIGN_WEBHOOK_CLIENT_ID || c.ADOBE_SIGN_CLIENT_ID, devAuthAllowed: c.DEV_AUTH && !production };
}
