// Configuration from environment variables (Key Vault references in Azure). Fails fast on anything missing.
// Each integration is one switch, so it can be connected later without code changes (docs/11-configuration.md):
//   sign-in      AUTH_MODE         local (email and password in VeQMS) → entra (Microsoft 365)
//   signatures   ADOBE_SIGN_MODE   mock (simulated, recorded as not Part 11) → live
//   files        SHAREPOINT_MODE   off → mock → live;  STORAGE_MODE  database or local → azure
// VEQMS_MODE=pilot (with NODE_ENV=production) allows the placeholders, for test and pilot data only. Production
// (NODE_ENV=production without it) requires Microsoft sign-in, Adobe Sign, SharePoint and Azure storage, all live.
import { z } from 'zod';

const bool = z.enum(['0', '1', 'true', 'false']).optional().transform((v) => v === '1' || v === 'true');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  VEQMS_MODE: z.enum(['pilot', 'production']).optional(),
  // entra: Microsoft Entra ID access tokens. local: email and password accounts held in VeQMS (development and pilot).
  AUTH_MODE: z.enum(['entra', 'local']).default('entra'),
  // Signs the API's own session tokens in local mode: at least 32 random characters, kept secret.
  LOCAL_AUTH_SECRET: z.string().default(''),
  // The tenant_directory key local sign-in uses (the bootstrap script creates it). Microsoft sign-in later adds the
  // Entra tenant ID as a second key for the same tenant, so people and records carry over.
  LOCAL_TENANT_KEY: z.string().default('local'),
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
  // azure: Blob storage (immutable records container). local: a folder (docker compose). database: a write-once
  // table in PostgreSQL, so a container host needs no disk; files are backed up with the database.
  STORAGE_MODE: z.enum(['azure', 'local', 'database']).default('local'),
  STORAGE_ACCOUNT_URL: z.string().default(''),
  STORAGE_CONTAINER: z.string().default('records'),
  LOCAL_STORAGE_DIR: z.string().default('./storage-local'),
  SCIM_TOKEN: z.string().default(''),
  GRAPH_MAIL_FROM: z.string().default(''),
  // SharePoint as the file store (docs/10-sharepoint.md). live: Microsoft Graph, app-only, Sites.Selected with write on
  // the one site. mock: a folder under LOCAL_STORAGE_DIR stands in for both libraries (development and tests).
  // off: not connected yet; documents are written in VeQMS and Effective versions wait to be published.
  SHAREPOINT_MODE: z.enum(['live', 'mock', 'off']).default('mock'),
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

export type Mode = 'development' | 'pilot' | 'production';
export type Config = z.infer<typeof schema> & { webhookClientId: string; devAuthAllowed: boolean; mode: Mode };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  const deployed = c.NODE_ENV === 'production';
  const mode: Mode = !deployed ? 'development' : c.VEQMS_MODE === 'pilot' ? 'pilot' : 'production';
  // Deployed (pilot or production): never the development persona sign-in.
  if (deployed && c.DEV_AUTH) throw new Error('DEV_AUTH must not be set when NODE_ENV=production (pilot or production)');
  if (c.AUTH_MODE === 'local' && c.LOCAL_AUTH_SECRET.length < 32) throw new Error('AUTH_MODE=local needs LOCAL_AUTH_SECRET of at least 32 random characters');
  if (c.AUTH_MODE === 'entra' && deployed && (!c.ENTRA_TENANT_ID || !c.ENTRA_API_AUDIENCE)) throw new Error('AUTH_MODE=entra needs ENTRA_TENANT_ID and ENTRA_API_AUDIENCE');
  // Production only: real sign-in, signatures and files. Pilot may use the placeholders (test and pilot data only).
  if (mode === 'production') {
    const fix = ' in production (set VEQMS_MODE=pilot for a pilot with placeholders)';
    if (c.AUTH_MODE !== 'entra') throw new Error('AUTH_MODE must be entra' + fix);
    if (c.ADOBE_SIGN_MODE !== 'live') throw new Error('ADOBE_SIGN_MODE must be live' + fix);
    if (c.SHAREPOINT_MODE !== 'live') throw new Error('SHAREPOINT_MODE must be live' + fix);
    if (c.STORAGE_MODE !== 'azure') throw new Error('STORAGE_MODE must be azure' + fix);
  }
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
  return { ...c, webhookClientId: c.ADOBE_SIGN_WEBHOOK_CLIENT_ID || c.ADOBE_SIGN_CLIENT_ID, devAuthAllowed: c.DEV_AUTH && !deployed, mode };
}
