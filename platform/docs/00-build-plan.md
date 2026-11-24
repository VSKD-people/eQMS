# VeQMS platform: build plan (from scratch)

Status: approved by the owner to start. The `platform/` code described in the hand-over brief was not in the
repository, so Phase 1 is being rebuilt. Nothing in this folder is described as "compliant"; each feature
supports a control and produces evidence.

## Constraint found at the start

The build environment's network policy blocks `registry.npmjs.org` (proxy returns 403). Nothing can be
installed from npm. Until that is changed, work is limited to what needs no packages:

| Part | Can be built and run here? |
|---|---|
| PostgreSQL schema, RLS, audit chain, invariant tests (`psql`) | Yes. PostgreSQL 16 is installed |
| Domain rules (`packages/domain`) in TypeScript | Yes, with Node's type stripping and `node:test`. No bundler or type checker (`tsc` is an npm package) |
| API (Fastify), web (Next.js), Playwright tests | Written but not installed, type-checked or run until npm is reachable |
| Azure Bicep, Docker, CI | Written, not run |

## Build order for Phase 1

1. **Database** (`packages/db`): migrations, row-level security, hash-chained audit log, insert-only signatures,
   locked training records, DocuSign envelope and allowance rules, outbox. Invariant tests in SQL.
2. **Domain** (`packages/domain`): permissions, signing plan, allowance years, training status, Connect HMAC.
3. **API** (`apps/api`): Fastify services and routes over `withTenant` (one request, one transaction).
4. **Web** (`apps/web`): Next.js, server-side API calls only.
5. **Infra and CI**: Bicep (UK South), Dockerfiles, GitHub Actions.

Steps 3 to 5 need the registry. Steps 1 and 2 are started first.

## Rules carried into the schema

- The database enforces compliance rules; they are not moved into the API only.
- Every tenant table has `tenant_id`, row-level security (forced), grants, and an invariant test.
- The API sets `app.tenant_id` and `app.user_id` with `SET LOCAL` at the start of each transaction.
- Audit entries are written in the same transaction as the change. The hash is computed by a trigger under a
  per-tenant advisory lock, so the application cannot supply or skip it.
- Approved document versions, signatures and audit entries cannot be updated or deleted.
- A signature needs a fresh sign-in later than the signing intent (`auth_time > intent_at`), checked by the database.
- The author of a version cannot sign it as approver unless a logged override is referenced.

## Assumptions to confirm (flagged, not decided)

- Canonical JSON for the audit hash uses PostgreSQL's `jsonb` text output, not RFC 8785. The Step 1 plan marks
  RFC 8785 as "verify". A verifier outside PostgreSQL would need the same serialisation; this is recorded in
  `docs/02-data-model.md`.
- First effective version numbering stays at 0.1 as in the prototype (open decision in the brief).
- Retention periods and the storage immutability period are placeholders until decided.
- Pricing and legal questions go to PJ Walters.
