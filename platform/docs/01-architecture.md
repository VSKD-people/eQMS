# 01 · Architecture (Phase 1)

How the live VeQMS is put together, and why. The clickable prototype in `../veqms/` is the reference for screens and
flows; the specs in `../specs/` win where they disagree with either.

## The parts

```
 Browser ──HTTPS──▶ Web app (Next.js 16, React 19)          Azure Container Apps, UK South
                     │  signs people in with Entra ID (auth code + PKCE)
                     │  keeps the session in an encrypted cookie
                     │  calls the API from the server only, with the user's access token
                     ▼
                    API (Node 22, Fastify 5, TypeScript) ──▶ PostgreSQL 16 (Azure Flexible Server, private network)
                     │  validates the Entra token on every request       row-level security per tenant
                     │  one database transaction per request             append-only, hash-chained audit log
                     │  the only component that touches the database     insert-only signatures, locked training records
                     ├──▶ Blob storage (immutable container): original PDFs, signed PDFs, audit reports
                     ├──▶ Adobe Sign REST API v6 (OAuth or integration key) ◀── Adobe Sign webhooks (secret URL, client ID echo)
                     ├──▶ Microsoft Graph (email from a shared mailbox)
                     └──◀ Entra ID SCIM provisioning (users, groups, leavers)

 Container Apps jobs: veqms-migrate (every deployment), veqms-reminders (daily 06:00 UTC)
```

| Folder | What it is |
|---|---|
| `packages/domain` | Pure rules shared by API and web: roles and permissions, the Adobe Sign signing plan, allowance years, training status, Adobe Sign webhook checks, the Excel writer. No I/O; unit-tested |
| `packages/db` | SQL migrations, demo seed, invariant tests, and the connection helpers (`withTenant`) |
| `apps/api` | The API: routes, services, integrations (Adobe Sign, storage, mail), the daily job |
| `apps/web` | The web app |
| `infra` | Bicep for Azure, start-up scripts for the jobs, a local database script |
| `docs` | This set of documents |

## Rules the design depends on

1. **The database enforces the rules that matter for compliance**, not just the API. Row-level security on every
   tenant table; the API's role (`veqms_app`) can't delete quality records, can't edit the audit log, signatures,
   agreement events or Adobe Sign transactions, and can't bypass row-level security. Training records are locked once completed
   and only the trainee can confirm their own. A bug in the API can't quietly break these. See
   [02 · Data model](02-data-model.md) and [04 · Security and compliance](04-security-and-compliance.md).
2. **One request, one transaction.** `withTenant` opens a transaction, sets `app.tenant_id` and `app.user_id`,
   runs the work and commits. The audit triggers and row-level security read those settings. If anything fails, the
   whole change rolls back, including its audit entries. Refusals that must still be logged (segregation of duties,
   access denied) are written by the error handler in a transaction of their own.
3. **Two signing routes** (decided in the signatures and training sign-off brief):
   - **Route 1, Adobe Sign with its Bio-Pharma settings:** every signature except read-and-understood training. Built
     in Phase 1: approvals of controlled documents (including vendor approvals and validation plans and reports), CAPA
     closures and deviation closures; later phases add change requests, periodic reviews and the other sign-offs. One
     agreement per sign-off holds every signer in order (for a document: author, reviewers, QA approver). A document
     is reviewed and approved in VeQMS first; the last approval sends the agreement. Every agreement sent counts as
     one transaction against the yearly allowance. See [06 · Adobe Sign](06-adobe-sign.md).
   - **Route 2, in the app:** read-and-understood training. The trainee confirms a statement; the system sets the
     dates; corrections are new records.
4. **The webhook notifies, the API confirms.** An Adobe Sign webhook notification only tells the API to look: the API reads the
   agreement from Adobe Sign and acts on that. The daily job polls agreements that have been out for more than a day.
5. **The browser never calls the API.** Pages and Server Actions call it from the web server with the user's token.
   The web app hides buttons the user can't use, but the API checks every permission again.
6. **Configuration, not code, for each tenant**: allowance, allowance year, reminder days, the read-and-understood
   statement. Tenant-specific secrets live in Key Vault.

## Identity

- People sign in with Microsoft Entra ID (single sign-on). The web app is a confidential client; the API validates
  the access token (issuer, audience, `access_as_user` scope) against Entra's published keys.
- Users and groups arrive through SCIM provisioning. New users get the Employee role; a System Administrator grants
  other roles in VeQMS. Group changes and leavers reconcile training at once.
- The API looks the user up on every request and refuses revoked or departed users, and tokens issued before their
  sessions were ended.
- Development and UAT can use a persona picker (`DEV_AUTH=1`), which the API refuses when `NODE_ENV=production`.

## Phase 1 scope

In Phase 1: sign-in, users and roles, documents through draft, review and the Adobe Sign approval route, CAPA and
deviation closure through Adobe Sign, read-and-understood training (allocation, confirmation, quiz, corrections,
matrix, reminders), the approvals register and transactions log, the audit trail and its check, settings, report exports
(Excel and PDF), SCIM.

The database already holds every module (change requests, observations, quality events, CAPAs and actions, evidence,
periodic reviews, automation rules) so later phases add screens and API routes without reshaping the data. See
`../BUILD_PROMPT.md` for the phases.

## What is not decided yet

These come from the open questions in `../specs/` or from building Phase 1. Each needs an owner's decision before
go-live:

- Recovery targets (RPO and RTO), the retention schedule, and the storage immutability period. The Bicep default of
  3650 days is a placeholder, not a decision.
- Who approves Entra app registrations, and the technical contact for incidents.
- Whether a first version that becomes effective should be numbered 1.0. The prototype and this build keep the
  draft number (0.1).
- Azure and Adobe Sign costs. Pricing approval goes to **PJ Walters**.
