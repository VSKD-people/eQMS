// Configuration from environment variables (Key Vault references in Azure). Fails fast on anything missing.
import { z } from 'zod';

const bool = z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  // Which deployment this is. Azure runs NODE_ENV=production everywhere; VEQMS_STAGE=staging marks a test
  // environment, where Adobe Sign and SharePoint may stay in mock mode until their accounts are set up. Unset or
  // anything else under NODE_ENV=production counts as production, which requires both live.
  VEQMS_STAGE: z.enum(['staging', 'production']).optional(),
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
  // SharePoint as the file store (docs/10-sharepoint.md). live: Microsoft Graph, app-only, Sites.Selected with write on
  // the one site. mock: a folder under LOCAL_STORAGE_DIR stands in for both libraries (development and tests).
  SHAREPOINT_MODE: z.enum(['live', 'mock']).default('mock'),
  SHAREPOINT_SITE_ID: z.string().default(''),
  SHAREPOINT_DRAFTS_DRIVE_ID: z.string().default(''),
  SHAREPOINT_CONTROLLED_DRIVE_ID: z.string().default(''),
  // The VeQMS app's ID as Graph reports it in lastModifiedBy.application.id: changes by this app are VeQMS's own.
  SHAREPOINT_APP_ID: z.string().default(''),
  // Controlled library columns VeQMS sets on each published file (internal names). Placeholders until the library exists.
  SHAREPOINT_COLUMNS: z.string().default('{"number":"DocumentNumber","version":"DocumentVersion","status":"DocumentStatus","effective":"EffectiveDate","sha256":"SHA256"}'),
  // Today's library columns, for the one-off import (internal names). Placeholders: the real names are still needed.
  SHAREPOINT_IMPORT_MAP: z.string().default('{"number":"DocumentNumber","title":"Title","type":"DocumentType","version":"DocumentVersion","owner":"OwnerEmail","classification":"Classification","process":"QualityProcess","effective":"EffectiveDate"}'),
  APP_BASE_URL: z.string().default('http://localhost:3000')
});

export type Stage = 'development' | 'staging' | 'production';
export type Config = z.infer<typeof schema> & { webhookClientId: string; devAuthAllowed: boolean; stage: Stage };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  const production = c.NODE_ENV === 'production';
  const stage: Stage = !production ? 'development' : c.VEQMS_STAGE === 'staging' ? 'staging' : 'production';
  // Staging and production alike: real Entra sign-in, never the development sign-in.
  if (production && c.DEV_AUTH) throw new Error('DEV_AUTH must not be set in production or staging');
  if (production && (!c.ENTRA_TENANT_ID || !c.ENTRA_API_AUDIENCE)) throw new Error('ENTRA_TENANT_ID and ENTRA_API_AUDIENCE are required in production and staging');
  // Production only: signatures and controlled files must be real. Staging may simulate them (placeholders).
  if (stage === 'production' && c.ADOBE_SIGN_MODE !== 'live') throw new Error('ADOBE_SIGN_MODE must be live in production (set VEQMS_STAGE=staging for a test environment)');
  if (stage === 'production' && c.SHAREPOINT_MODE !== 'live') throw new Error('SHAREPOINT_MODE must be live in production (set VEQMS_STAGE=staging for a test environment)');
  if (c.SHAREPOINT_MODE === 'live' && (!c.SHAREPOINT_SITE_ID || !c.SHAREPOINT_DRAFTS_DRIVE_ID || !c.SHAREPOINT_CONTROLLED_DRIVE_ID || !c.SHAREPOINT_APP_ID)) {
    throw new Error('SharePoint live mode needs SHAREPOINT_SITE_ID, SHAREPOINT_DRAFTS_DRIVE_ID, SHAREPOINT_CONTROLLED_DRIVE_ID and SHAREPOINT_APP_ID');
  }
  for (const k of ['SHAREPOINT_COLUMNS', 'SHAREPOINT_IMPORT_MAP'] as const) {
    try { if (typeof JSON.parse(c[k]) !== 'object') throw new Error(); } catch { throw new Error(`${k} must be a JSON object of column names`); }
  }
  if (c.ADOBE_SIGN_MODE === 'live') {
    if (c.ADOBE_SIGN_AUTH === 'integration-key' && !c.ADOBE_SIGN_INTEGRATION_KEY) throw new Error('Adobe Sign live mode with an integration key needs ADOBE_SIGN_INTEGRATION_KEY');
    if (c.ADOBE_SIGN_AUTH === 'oauth' && (!c.ADOBE_SIGN_CLIENT_ID || !c.ADOBE_SIGN_CLIENT_SECRET || !c.ADOBE_SIGN_REFRESH_TOKEN || !c.ADOBE_SIGN_API_ACCESS_POINT)) {
      throw new Error('Adobe Sign live mode with OAuth needs ADOBE_SIGN_CLIENT_ID, ADOBE_SIGN_CLIENT_SECRET, ADOBE_SIGN_REFRESH_TOKEN and ADOBE_SIGN_API_ACCESS_POINT');
    }
    if (c.ADOBE_SIGN_WEBHOOK_TOKEN.length < 32) throw new Error('Adobe Sign live mode needs ADOBE_SIGN_WEBHOOK_TOKEN of at least 32 random characters');
  }
  return { ...c, webhookClientId: c.ADOBE_SIGN_WEBHOOK_CLIENT_ID || c.ADOBE_SIGN_CLIENT_ID, devAuthAllowed: c.DEV_AUTH && !production, stage };
}
