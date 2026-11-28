# 12 · Running the pilot on a container host

This runs VeQMS for a pilot before Microsoft 365, Adobe Sign, SharePoint and Azure administration are available:
email and password sign-in, simulated signatures (not Part 11), SharePoint not connected, and files in PostgreSQL.
**Test and pilot data only.** The settings are explained in [11 · Configuration](11-configuration.md).

Running costs need approval: send pricing questions to **PJ Walters**. This page names no prices.

## What the host needs

Any container host that offers these will do. Check each in your provider's documentation before you choose:

- Two services built from this repository's Dockerfiles: the API (`apps/api/Dockerfile`, internal only) and the web
  app (`apps/web/Dockerfile`, public HTTPS). Both build from the `platform/` folder.
- A release or pre-deploy command that runs before each new API version starts (the migrations).
- Scheduled jobs (cron) running the API image with a different command.
- A one-off command (shell or job) for the bootstrap script.
- Managed PostgreSQL **16** with daily backups and point-in-time restore, the `pgcrypto` extension, and an owner
  login that can create roles (`CREATEROLE`). The migrations create the roles `veqms_owner`, `veqms_app` and
  `veqms_readonly`. **Verify** your provider allows this before you choose it.
- Secrets held by the host, not in Git.

Try the whole stack first on one machine with `docker-compose.pilot.yml` (instructions at its top); its browser test
is `e2e/pilot/pilot.spec.ts`.

## Steps

1. **Database.** Create the PostgreSQL 16 database. Keep two connection strings: the **owner's** (for migrations and
   the bootstrap) and, after step 3, the API's (`veqms_api`).
2. **Secrets.** Generate each with `openssl rand -base64 36`: `APP_DB_PASSWORD` (the API's database password),
   `LOCAL_AUTH_SECRET`, and `SESSION_SECRET` (32 bytes: `openssl rand -base64 32`). Store them as host secrets.
3. **API service.** From `apps/api/Dockerfile`, private, health check `GET /ready`. Settings:

   | Setting | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `VEQMS_MODE` | `pilot` |
   | `DATABASE_URL` | `postgres://veqms_api:<APP_DB_PASSWORD>@<host>:5432/<db>` |
   | `DATABASE_SSL` | `1` if the provider requires TLS |
   | `AUTH_MODE` | `local` |
   | `LOCAL_AUTH_SECRET` | the secret |
   | `ADOBE_SIGN_MODE` | `mock` |
   | `SHAREPOINT_MODE` | `off` |
   | `STORAGE_MODE` | `database` |
   | `APP_BASE_URL` | the web app's HTTPS address |
   | `OWNER_DATABASE_URL` | the owner's connection (used only by the release command) |

   Release command, so every deployment migrates first and keeps the API's login current:

   ```bash
   sh -c 'DATABASE_URL="$OWNER_DATABASE_URL" node packages/db/dist/migrate.js && DATABASE_URL="$OWNER_DATABASE_URL" APP_DB_USER=veqms_api node packages/db/dist/provision.js'
   ```

   `provision.js` also needs `APP_DB_PASSWORD` set on the service.
4. **Web service.** From `apps/web/Dockerfile`, public HTTPS, health check `GET /login`. Settings: `API_BASE_URL` (the
   API's private address on the host), `APP_BASE_URL` (its own HTTPS address), `AUTH_MODE=local`, `SESSION_SECRET`.
   Don't set `VEQMS_LOCAL`.
5. **Create the organisation and the first two people,** once, with the owner's connection. One must be the System
   Administrator and the other the Quality Manager (an administrator can't approve):

   ```bash
   DATABASE_URL="$OWNER_DATABASE_URL" node apps/api/dist/jobs/bootstrap.js --org "Organisation name" --admin-email <email> --admin-name "<name>" --qm-email <email> --qm-name "<name>" --groups "All staff"
   ```

   It prints a temporary password for each: give it to the person directly, and clear it from any kept log. Both must
   change it at their first sign-in. Running it again is refused.
6. **Scheduled jobs,** each running the API image with the API's settings:

   | Job | Command | When |
   |---|---|---|
   | Daily | `node apps/api/dist/jobs/reminders.js` | Once a day (training reminders, overdue notices, retention) |
   | Audit anchors | `node apps/api/dist/jobs/anchor.js` | Every 15 minutes (with files in the database, see [11](11-configuration.md)) |

   The SharePoint job isn't needed until SharePoint is connected.
7. **People.** The System Administrator adds everyone else in Administration → Users, with a temporary password each,
   and resets forgotten passwords there.
8. **Check:** sign in as each of the first two people and change the passwords; the Pilot banner shows; create a test
   document, make its PDF, submit, approve and sign it (simulated); it becomes Effective and Administration →
   SharePoint shows it waiting to publish; Administration → Audit trail → Verify the chain passes.

## Backups and the end of the pilot

- The host's database backups cover everything, files included. Test a restore once during the pilot.
- Pilot records aren't controlled records. Production starts on Azure from a fresh database with every integration
  live ([05](05-deployment-azure.md)); the pilot database can then be archived or deleted, as Quality decides.

## Not tested yet

The pilot stack has run only with `docker-compose.pilot.yml` on one machine. Not yet run on any container host: the
release command, scheduled jobs, the owner's `CREATEROLE` permission and TLS on a managed database.
