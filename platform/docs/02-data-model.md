# Data model

Source: Step 1 Architecture & Delivery Plan (data model and modelling rules). Migrations are in
`packages/db/migrations`, applied in order by `scripts/migrate.sh`.

## Request identity

The API runs every request in one transaction and sets, with `set_config(..., true)` (the same as `SET LOCAL`):

- `app.tenant_id`: read by `app_tenant()`. Every row-level security policy compares `tenant_id` to it.
- `app.user_id`: read by `app_user_id()`. Fills `created_by`, `updated_by`, the audit actor, and the trainee check.

With no tenant set, no tenant rows are visible and audit inserts are refused.

## Database roles

| Role | Use | Notes |
|---|---|---|
| `veqms_owner` | Runs migrations, owns objects | Created by `scripts/roles.sql`. Tests currently run migrations as a superuser |
| `veqms_app` | The API connects as this role | `nobypassrls`. No update or delete grant on insert-only tables; no delete on records |

Rules are enforced twice where it matters: by missing grants, and by triggers that refuse the change even for a
role that holds every grant. Both layers are tested.

## Tables

| Table | Rule enforced in the database |
|---|---|
| `tenant`, `site` | Tenant isolation |
| `app_user` | Never deleted (signatures and training records stay attached). `status = 'Disabled'` exactly when `disabled_at` is set |
| `user_role`, `app_group`, `group_member` | Roles: admin, qm, author, reviewer, approver, process, employee, auditor |
| `audit_log_entry` | Insert-only (no grant, plus triggers on update, delete and truncate). `seq`, `prev_hash`, `hash`, time and tenant are set by the trigger |
| `record` | Shared header for every module. Soft delete only, never under legal hold, no restore. A `Document` can become `Effective` only with an approval signature on an approved version, or a version marked `migrated_from_kstarrs` |
| `document_version` | Change summary required. Once `approved_at` is set, content fields cannot change and status cannot go back to a draft state. Approved states need `approved_at` and `content_sha256` |
| `signature` | Insert-only. `auth_time > intent_at` (a fresh sign-in after the signing started). Hash must equal the version's `content_sha256`. The version's author cannot sign `Approved` unless `sod_override_by` and a reason are recorded |
| `training_assignment` | One per user per version. Never deleted |
| `training_record` | Insert-only. Only the trainee can confirm their own training. `completed_at` and `created_by` are set by the database. A correction is a new row that references the original, with a reason |
| `docusign_settings` | Allowance (default 500), allowance year start month, go-live date |
| `docusign_envelope` | One live envelope (Created, Sent, Delivered) per version. `Completed` needs the completion time, signed PDF and certificate |
| `docusign_signer` | Routing order per signer (author 1, reviewers 2, approvers 3 onwards) |
| `docusign_send` | Insert-only, one row per envelope send. Allowance year set by the database |
| `docusign_allowance_use` | View: sends used and remaining per allowance year (security invoker, so RLS applies) |
| `outbox_event` | Written in the same transaction as the change. Never deleted |

## Audit hash chain

`hash = sha256(prev_hash || canonical(entry))`, chained per tenant, starting from 64 zeros. The insert trigger
takes `pg_advisory_xact_lock` on the tenant before reading the previous entry, so concurrent saves queue and the
chain cannot fork (tested with 8 sessions and 200 inserts).

`verify_audit_chain(tenant)` recomputes the whole chain and returns `ok`, the number of entries, and the first
broken `seq`.

**Assumption to confirm.** The canonical form is PostgreSQL `jsonb` text output of a fixed set of fields, with
timestamps as UTC to the microsecond. It is not RFC 8785 (JCS), which the Step 1 plan proposed and marked
"verify". A verifier written outside PostgreSQL must reproduce `jsonb` key ordering (shorter keys first, then
byte order). If RFC 8785 is required, `audit_canonical()` must change before any real entries are written.

Not built yet: anchoring the chain head to immutable Blob storage every 15 minutes, the hourly and nightly
verifier jobs, and the alert on mismatch.

## Differences from the prototype

- The allowance year is computed in UTC. The prototype used the browser's local time, so a send in the first
  hours of the start month could fall in a different year.
