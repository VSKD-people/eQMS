# 08 · Migrating from KSTARRS and SharePoint

VeQMS replaces KSTARRS for approvals and training sign-off. This is the method for bringing existing records across.
Phase 1 includes the database support (import mode) and an import job for today's SharePoint library
(`apps/api/src/jobs/import-sharepoint.ts`, reading the library through Microsoft Graph). There is no KSTARRS import
script yet: its exports weren't available to write it against. Write it once you have a sample export, and test it on
a copy.

## What to bring across

| From | Records | Lands in |
|---|---|---|
| SharePoint (published QMS documents) | Current effective version of each controlled document: number, title, type, owner, classification, effective date, and the PDF | `documents`, `document_versions` (`state = 'Effective'`, `migrated_from = 'SharePoint'`, the PDF copied to records storage and its hash, `published_item_id` pointing at the file already in the controlled library). Use the import job below |
| KSTARRS approvals | Who approved which version, when, with what meaning | `signatures` (`source = 'kstarrs'`), `document_versions.approved_at` |
| KSTARRS training sign-offs | Who confirmed reading which version, when | `training_records` with the original `completed_at` and a statement saying it was migrated |
| Open training items | Who still has to read what | Don't import: set each document's audience in VeQMS and let it allocate |
| People and groups | | Entra ID provisioning (SCIM), before any import |

Decide with the Quality Manager how far back to go. Older history can stay in KSTARRS (read-only) or an archived
export, provided it stays retrievable for the retention period.

## Import mode

Normal rules stop history from being written: the system sets dates, and only the trainee can complete a training
record. Import mode lifts exactly those two rules, and only for the migration:

- It is on only when the session runs as `veqms_owner` **and** sets `app.import_mode = 'on'` (`app.import_mode()`).
  The API's role can never use it (an invariant test checks this).
- Every row written in import mode is still audited, with action `training.import` for training records, so the trail
  shows what was migrated and when.
- All the other rules still apply: row-level security, insert-only signatures, locked records once completed.

The demo seed (`packages/db/seed/001_demo.sql`) is a worked example: it runs as `veqms_owner`, switches on import
mode, sets the tenant, and loads documents, versions, signatures marked `kstarrs`, agreements and training records
with historical dates.

## Importing the SharePoint library

The import job reads the controlled library through Graph (no CSV export). Field mapping is a setting,
`SHAREPOINT_IMPORT_MAP` (see [10 · SharePoint](10-sharepoint.md)); **the library's real column names are needed**
before it can run.

1. Provision people through Entra first: each document's owner must be an active VeQMS user.
2. Dry run: `node apps/api/dist/jobs/import-sharepoint.js --tenant <tenant id>`. It prints how many files there are,
   how many map cleanly, the hash of the listing, and every file it can't map with the reason. Nothing is written.
   Fix the library or decide each problem with the Quality Manager.
3. Apply on a staging copy: add `--apply`. Each document is imported in its own transaction as `veqms_owner` with
   import mode on, with an `import` audit entry carrying the file's hash and the listing hash.
4. Reconcile (below), then repeat on production.

Run it from a workstation signed in with `az login` as someone who is the database owner and can read the library
(the job uses `DefaultAzureCredential` for both). **Verify** this sign-in route before the real run.

## Method

1. **Freeze** KSTARRS for new approvals from an agreed date; record that date as `settings.signing_go_live`.
2. **Export** from KSTARRS to CSV, and run the SharePoint import as a dry run. Keep the raw exports and the dry-run
   report, hashed (SHA-256), as migration evidence.
3. **Map** each column to the tables above; agree how meanings map to Authored, Reviewed, Approved; list records that
   can't be mapped and decide each one.
4. **Load into a staging copy** with a script that runs as `veqms_owner` with import mode on, inside one transaction
   per batch, with the tenant set (`set_config('app.tenant_id', …)`).
5. **Reconcile**: counts per document and per person against the exports; spot-check a sample against the source
   with the Quality Manager; run `app.verify_audit_chain()`.
6. **Approve** the migration report (it is part of the validation evidence), then repeat steps 4 and 5 on production
   during a quiet window and switch import mode off.
7. **Keep** KSTARRS read-only, or its final export, for as long as the retention schedule requires.

## Checks before production

- Import mode is a session setting, so it ends when the import script's session ends. Confirm no `training.import`
  entries appear in the audit trail after the cut-over.
- Every migrated document has exactly one Effective version.
- Every audience is set, so new starters are allocated the documents they need.
- The audit chain verifies.
