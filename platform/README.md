# VeQMS platform (Phase 1)

The live, full-stack version of VeQMS: a PostgreSQL database, a Node API, a Next.js web app, and the Azure
infrastructure to run them in UK South. The clickable prototype in `../veqms/` stays as the reference for screens
and flows; the specs are in `../specs/`.

> **Status.** Built with the real packages (lockfile committed). Type-check, build, the domain tests, the database
> invariants and the API flow test pass. `docker compose up --build` runs the whole stack, and the ten UAT scenarios
> pass in a browser (Playwright, `e2e/`). The Bicep compiles. Not yet run: Microsoft Entra sign-in, live Adobe Sign,
> live SharePoint, Microsoft Graph email, Azure Blob storage, anything in Azure and the deploy workflow. Next steps are in "First tasks" in [BUILD_PROMPT.md](BUILD_PROMPT.md).
> **Pilot.** Before Microsoft 365, Adobe Sign and SharePoint are connected, VeQMS can run as a pilot on any container host
> with PostgreSQL: email and password sign-in, simulated signatures (not Part 11), SharePoint off. Test and pilot data
> only. See [12 · Pilot hosting](docs/12-pilot-hosting.md) and [11 · Configuration](docs/11-configuration.md).
> Details: [07 · Testing and validation](docs/07-testing-and-validation.md).

## What Phase 1 does

- Microsoft Entra ID sign-in; users and groups from Entra (SCIM); roles granted in VeQMS.
- Documents, by the amendment flow: every amendment starts as a change request; at submit the draft becomes a
  locked, hashed PDF that the author checks (footer, version, document ID, dates); review and approval in VeQMS, where
  each QA approver decides whether retraining is needed; the last approval sends one **Adobe Sign** agreement with
  every signer (author, reviewers, QA approvers, in order). Returns to the author at any point before signing; every
  transaction counted against the yearly allowance; cancel and decline back to draft; corrections as new
  transactions; signed PDF and Adobe Sign audit report stored.
- CAPA and deviation closure through Adobe Sign. Every signature goes through Adobe Sign except read-and-understood
  training; change requests and the other sign-offs follow in later phases.
- Read-and-understood training in the app: audiences per document, allocation, confirmation with optional quiz,
  locked records, corrections as new records, matrix, reminders.
- SharePoint as the file store: authors write in Word in a Drafts library; each Effective version's locked PDF is
  published to a controlled library only VeQMS writes to; a delta sync raises integrity alerts for changes made
  outside VeQMS, and a nightly check re-hashes every published file. Mock mode for development.
- Approvals register and transactions log, audit trail with a hash-chain check, Excel and PDF reports, settings.

## Folders

| Folder | Contents |
|---|---|
| `packages/domain` | Shared business rules, no I/O |
| `packages/db` | Migrations, demo seed, invariant tests, connection helpers |
| `apps/api` | Fastify API, Adobe Sign, storage and mail integrations, daily job, tests |
| `apps/web` | Next.js web app |
| `infra` | Bicep (Azure UK South), job scripts, local database set-up |
| `docs` | The documentation set (below) |

## Run it locally

Needs Docker, or Node 22.12+ and PostgreSQL 16.

```bash
docker compose up --build
```

Then open http://localhost:3000 and pick a persona. Adobe Sign runs in mock mode: each signer signs in VeQMS when it is
their turn. Sample data only.

Without Docker: copy `.env.example` to `.env` and `apps/web/.env.example` to `apps/web/.env.local`, create a
database called `veqms`, run `infra/local/initdb/01-local-login.sql` against it (creates the API's local login), then:

```bash
npm install
```

```bash
npm run build
```

Migrations and the demo seed run as the database owner (here the `postgres` user), not as the API's login:

```bash
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/veqms npm run db:migrate
```

```bash
DATABASE_URL=postgres://postgres:YOUR_PASSWORD@localhost:5432/veqms npm run db:seed
```

```bash
npm run dev:api
```

```bash
npm run dev:web
```

## Checks

```bash
npm run typecheck && npm test
```

```bash
npm run db:test
```

The API flow test needs `DATABASE_URL` pointing at a freshly migrated and seeded database (it changes data). CI runs
everything on each push: `.github/workflows/platform-ci.yml`.

Browser tests for the UAT scenarios, against a freshly started local stack (`docker compose up --build`):

```bash
cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

They change data too: to run them again, start from a fresh database (`docker compose down -v`, then up again).

## Documentation

| Document | For |
|---|---|
| [BUILD_PROMPT.md](BUILD_PROMPT.md) | Carrying on the build: rules, first tasks, Phases 2 to 7, open decisions |
| [01 · Architecture](docs/01-architecture.md) | How the parts fit and why |
| [02 · Data model](docs/02-data-model.md) | Tables, roles, the rules the database enforces |
| [03 · API](docs/03-api.md) | Every endpoint and setting |
| [04 · Security and compliance](docs/04-security-and-compliance.md) | Threats and controls, Part 11 mapping, open decisions |
| [05 · Deployment to Azure](docs/05-deployment-azure.md) | From an empty subscription to a live system |
| [06 · Adobe Sign](docs/06-adobe-sign.md) | The approval route and the Adobe Sign account set-up |
| [07 · Testing and validation](docs/07-testing-and-validation.md) | Test suites, what has run, UAT scenarios, validation |
| [08 · Migration](docs/08-migration.md) | Bringing records across from KSTARRS and SharePoint |
| [09 · Runbook](docs/09-runbook.md) | Day-to-day operations, incidents, leavers, restore |
| [10 · SharePoint](docs/10-sharepoint.md) | Word drafts, publishing, the delta sync, integrity alerts, the import, and what to verify |
| [11 · Configuration](docs/11-configuration.md) | Every setting, the pilot and production modes, and how to connect each integration later |
| [12 · Pilot hosting](docs/12-pilot-hosting.md) | Running the pilot on a container host before Microsoft 365, Adobe Sign and SharePoint are connected |
