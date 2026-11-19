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
  DOCUSIGN_MODE: z.enum(['live', 'mock']).default('mock'),
  DOCUSIGN_AUTH_SERVER: z.string().default('account-d.docusign.com'),
  DOCUSIGN_INTEGRATION_KEY: z.string().default(''),
  DOCUSIGN_USER_ID: z.string().default(''),
  DOCUSIGN_ACCOUNT_ID: z.string().default(''),
  DOCUSIGN_PRIVATE_KEY: z.string().default(''),
  DOCUSIGN_BASE_URI: z.string().default('https://demo.docusign.net'),
  DOCUSIGN_CONNECT_HMAC_KEYS: z.string().default(''),
  STORAGE_MODE: z.enum(['azure', 'local']).default('local'),
  STORAGE_ACCOUNT_URL: z.string().default(''),
  STORAGE_CONTAINER: z.string().default('records'),
  LOCAL_STORAGE_DIR: z.string().default('./storage-local'),
  SCIM_TOKEN: z.string().default(''),
  GRAPH_MAIL_FROM: z.string().default(''),
  APP_BASE_URL: z.string().default('http://localhost:3000')
});

export type Config = z.infer<typeof schema> & { connectHmacKeys: string[]; devAuthAllowed: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  const production = c.NODE_ENV === 'production';
  if (production && c.DEV_AUTH) throw new Error('DEV_AUTH must not be set in production');
  if (production && c.DOCUSIGN_MODE !== 'live') throw new Error('DOCUSIGN_MODE must be live in production');
  if (production && (!c.ENTRA_TENANT_ID || !c.ENTRA_API_AUDIENCE)) throw new Error('ENTRA_TENANT_ID and ENTRA_API_AUDIENCE are required in production');
  if (c.DOCUSIGN_MODE === 'live' && (!c.DOCUSIGN_INTEGRATION_KEY || !c.DOCUSIGN_USER_ID || !c.DOCUSIGN_ACCOUNT_ID || !c.DOCUSIGN_PRIVATE_KEY)) throw new Error('DocuSign live mode needs the integration key, user ID, account ID and private key');
  return { ...c, connectHmacKeys: c.DOCUSIGN_CONNECT_HMAC_KEYS.split(',').map((s) => s.trim()).filter(Boolean), devAuthAllowed: c.DEV_AUTH && !production };
}
