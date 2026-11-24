# 02 · Data model

PostgreSQL 16, schema `app`, 43 tables. Migrations are in `packages/db/migrations` and run in order; each runs once
(`app.schema_migrations`). The demo seed is `packages/db/seed/001_demo.sql`; the invariant tests are
`packages/db/test/001_invariants.sql`.

## Roles and tenancy

| Database role | Used by | Can |
|---|---|---|
| `veqms_owner` | migrations, seed, imports | own the schema; switch on import mode |
| `veqms_app` | the API (its managed identity is granted this role) | select, insert and update on tenant tables; delete only on configuration that is replaced as a whole (audiences, reviewer and approver lists, group members, role assignments). No delete on quality records, no update on insert-only tables, cannot bypass row-level security |
| `veqms_readonly` | reporting, auditors' database access if ever needed | select |

Every tenant table has a `tenant_id` and a row-level security policy `tenant_id = app.current_tenant()`, forced
for the table owner too. `app.current_tenant()` and `app.current_actor()` read the transaction settings that
`withTenant` sets. Three tables have no tenant data and no row-level security: `tenant_directory` (Entra tenant ID →
VeQMS tenant), `agreement_directory` (Adobe Sign agreement ID → tenant, for webhooks) and `schema_migrations`.

## Tables by migration

| Migration | Tables |
|---|---|
| `000_roles_and_helpers` | roles, schema `app`, helper functions (`current_tenant`, `current_actor`, `import_mode`, `forbid_change`, `touch_updated_at`), `schema_migrations` |
| `001_core` | `tenants`, `tenant_directory`, `users`, `user_roles`, `role_requests`, `groups`, `group_members`, `settings`, `counters`, `audit_log`, `signatures`, `tasks`, `notifications`, `notification_log` |
| `002_documents_signing` | `templates`, `documents`, `document_versions`, `document_reviewers`, `document_approvers`, `document_comments`, `audience_groups`, `audience_roles`, `audience_users`, `agreements`, `agreement_directory`, `agreement_signers`, `agreement_events`, `signing_transactions` |
| `003_training` | `training_records`, `quiz_questions` |
| `004_quality_reviews_automation` | `change_requests`, `cr_actions`, `observations`, `quality_events`, `capas`, `capa_actions`, `evidence`, `periodic_reviews`, `record_links`, `automation_rules`, `automation_runs`, `dead_letters` |
| `005_rls_and_grants` | row-level security on every tenant table; grants |

## Rules enforced in the database

| Rule | How |
|---|---|
| Audit log is append-only and tamper-evident | `audit_log` insert trigger takes a per-tenant advisory lock, numbers entries without gaps (`seq`), and stores `hash = sha256(previous hash + entry)`. Update and delete are refused. `app.verify_audit_chain()` recomputes the chain and returns the first broken entry |
| Everything important is audited | Triggers on training records; the API calls `app.audit()` for every other change, inside the same transaction |
| Signatures are insert-only and only from Adobe Sign | `signatures` refuses update and delete. `source` is `adobe_sign`, or `kstarrs` for migrated approvals: nothing is signed inside VeQMS |
| Training records | `training_guard`: system sets `assigned_at` and `completed_at`; only the trainee (`app.current_actor()`) can complete their own record (SQLSTATE P0003); a completed or closed record can't change; nothing is deleted. Corrections are new rows with `correction_of`. One live record per person, document and version (partial unique index) |
| Adobe Sign agreements | Must carry the four verification ticks (check constraint); one open agreement per record (partial unique index); subject, PDF hash, verification, sender and record fixed once sent; completed, declined and cancelled are final; completed needs the signed PDF and audit report hashes; declined and cancelled need a reason |
| Adobe Sign transactions | `signing_transactions` numbers each transaction within its allowance year under an advisory lock and refuses a transaction beyond the allowance (SQLSTATE P0002). Insert-only |
| Document versions | Content locked once out of draft; approved versions only move to Superseded or Obsolete |
| Record numbers | `app.next_number(prefix)` from `counters`, gap-free per tenant |
| Import mode | `app.import_mode()` is true only for `veqms_owner` with `app.import_mode = 'on'`. It allows historical dates on migrated records (training, transactions). The API role can never use it |

Errors from these rules come back to the API as SQLSTATE `P0001` (rule broken, HTTP 409), `P0002` (allowance used
up, 409), `P0003` (not yours to confirm, 403) or `42501` (permission denied, 403).

## Key relationships

- `documents` 1 — n `document_versions`; the current version is the newest; at most one is Effective.
- `documents` — `audience_groups` / `audience_roles` / `audience_users` decide who must read the effective version.
  `training_days` and `training_quiz` on the document set the due period and whether the quiz applies.
- `agreements` belong to one record (`record_type` + `record_id`): a document version, a CAPA or a quality event.
  `agreement_signers` hold the signing order; `agreement_events` the history; `signing_transactions` the transaction number.
  `correction_of` links a resend to the cancelled or declined agreement it replaces.
- `training_records` belong to a person, a document and a version; `agreement_id` is set for records created from an
  approval agreement (author and reviewers).
- `capas.source_event_id` → `quality_events`; `capas.closure_agreement_id` and `quality_events.closure_agreement_id`
  → the open closure agreement.

## Changing the schema

- Add a new numbered migration; never edit one that has run anywhere outside a developer's machine.
- New tenant tables need a `tenant_id`, an entry in the row-level security loop in `005` (or a later migration that
  does the same), and grants. Add an invariant test.
- Run `npm run db:test` (needs `psql` and a PostgreSQL 16 server) before you push.
