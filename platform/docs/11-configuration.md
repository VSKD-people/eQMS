# 11 · Configuration and integration switches

VeQMS runs before Microsoft 365, Adobe Sign and SharePoint are connected. Each integration is one setting, so
connecting it later is a configuration change, not a code change. This page lists every setting and what it does.

## Modes

| `NODE_ENV` | `VEQMS_MODE` | Mode | What it allows |
|---|---|---|---|
| anything but `production` | (any) | development | Everything simulated, including the demo persona sign-in (`DEV_AUTH=1`) |
| `production` | `pilot` | pilot | The placeholders below: email and password sign-in, simulated signatures, SharePoint off, files in the database. **Test and pilot data only.** A "Pilot" banner shows on every page |
| `production` | unset or `production` | production | Microsoft sign-in, Adobe Sign, SharePoint and Azure storage, all live. The API refuses to start otherwise |

The development persona sign-in is refused in pilot and production alike.

## The four switches

| Integration | Setting (API) | Placeholder (pilot) | Live (production) |
|---|---|---|---|
| Sign-in | `AUTH_MODE` (also set on the web app) | `local`: email and password held in VeQMS | `entra`: Microsoft 365 (Entra ID) |
| Signatures | `ADOBE_SIGN_MODE` | `mock`: signers sign on the record page; recorded as **simulated, not Part 11** | `live`: Adobe Acrobat Sign |
| Document files | `SHAREPOINT_MODE` | `off`: documents written in VeQMS; Effective versions wait to be published (`mock` is for development) | `live`: Word in the Drafts library, publishing to the controlled library |
| Stored files | `STORAGE_MODE` | `database`: a write-once table in PostgreSQL (`local` for docker compose) | `azure`: the immutable Blob container |

## API settings

| Setting | Needed when | Notes |
|---|---|---|
| `DATABASE_URL` | always | The API's own login (a member of `veqms_app`), never the owner |
| `DATABASE_SSL` | managed PostgreSQL | `1` to require TLS |
| `PORT` | | Default 8080 |
| `NODE_ENV`, `VEQMS_MODE` | | See Modes |
| `APP_BASE_URL` | always | The address people open; used in emails and links |
| `AUTH_MODE` | | `local` or `entra` |
| `LOCAL_AUTH_SECRET` | `AUTH_MODE=local` | At least 32 random characters. Signs the API's session tokens; changing it signs everyone out |
| `LOCAL_TENANT_KEY` | `AUTH_MODE=local` | Default `local`; must match the bootstrap script's key |
| `ENTRA_TENANT_ID`, `ENTRA_API_AUDIENCE` | `AUTH_MODE=entra` | See [05 · Deployment](05-deployment-azure.md), step 3 |
| `ADOBE_SIGN_MODE` and the `ADOBE_SIGN_*` settings | `live` | See [06 · Adobe Sign](06-adobe-sign.md) |
| `SHAREPOINT_MODE` and the `SHAREPOINT_*` settings | `live` | See [10 · SharePoint](10-sharepoint.md) |
| `STORAGE_MODE`, `STORAGE_ACCOUNT_URL`, `STORAGE_CONTAINER` | `azure` | `LOCAL_STORAGE_DIR` for `local` |
| `SCIM_TOKEN` | Entra provisioning | Not used in the pilot |
| `GRAPH_MAIL_FROM` | email | Empty: in-app notifications only |

## Web app settings

| Setting | Needed when | Notes |
|---|---|---|
| `API_BASE_URL` | always | The API's private address; the browser never calls the API |
| `APP_BASE_URL` | always | Same as the API's |
| `SESSION_SECRET` | always | 32 bytes, base64. Encrypts the session cookie |
| `AUTH_MODE` | | Must match the API's |
| `ENTRA_TENANT_ID`, `ENTRA_WEB_CLIENT_ID`, `ENTRA_WEB_CLIENT_SECRET`, `ENTRA_API_SCOPE` | `AUTH_MODE=entra` | See [05 · Deployment](05-deployment-azure.md), step 3 |
| `VEQMS_LOCAL` | plain-http testing on one machine only | Never on a real host, which serves HTTPS |

## What the placeholders mean for records

- **Simulated signatures** are stored with source `simulated` (never `adobe`), and their signed PDF and audit report
  say "SIMULATED SIGNATURES - NOT PART 11". The database refuses them unless the organisation's settings allow
  them (`settings.allow_simulated_signatures`: on for the pilot, off for production).
- **Email and password sign-in** is held in VeQMS: passwords only as scrypt hashes, five wrong passwords lock the
  account for 15 minutes, and every attempt is audited. It isn't single sign-on, and it isn't Part 11 signing.
- **Files in the database** are write-once, like the immutable container. The audit chain's anchors are then stored
  in the same database, so they no longer show a rewrite by a database administrator.
- Because of these, the pilot holds test and pilot data only. Production starts from a fresh database with every
  integration live.

## Connecting each integration later

1. **Microsoft 365 sign-in.** Register the apps ([05](05-deployment-azure.md), step 3). Point the Entra tenant at the
   same organisation, as the database owner:
   `insert into app.tenant_directory (entra_tenant_id, tenant_id) select '<Entra tenant ID>', tenant_id from app.tenant_directory where entra_tenant_id = 'local';`
   Then set `AUTH_MODE=entra` and the `ENTRA_*` settings on the API and the web app, and redeploy. People keep their
   accounts and records: the first Microsoft sign-in links each person by email. Passwords stop working.
2. **Adobe Sign.** Set up the account and webhook ([06](06-adobe-sign.md)); the API then needs a public address for
   the webhook. Set `ADOBE_SIGN_MODE=live` with its settings, and turn off simulated signatures:
   `update app.settings set allow_simulated_signatures = false;`
3. **SharePoint.** Set up the site and libraries ([10](10-sharepoint.md)) and set `SHAREPOINT_MODE=live`. Versions
   that became Effective while it was off are published by the next sync.
4. **Azure.** Production moves to Azure by [05 · Deployment](05-deployment-azure.md), with `STORAGE_MODE=azure`.
