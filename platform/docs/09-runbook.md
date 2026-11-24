# 09 · Operations runbook

How to run VeQMS in Azure once it is live: what to watch, what to do on a schedule, and what to do when something
goes wrong. Resource names follow `05-deployment-azure.md` (resource group `rg-veqms-prod`).

> **Status: not tested.** This runbook was written before the first deployment. Run every procedure once in a
> non-production environment, correct it, and record the result before relying on it. Commands marked *check*
> need confirming against the current Azure CLI reference.

## Who does what

| Role | Who | Notes |
|---|---|---|
| Support Owner | The person named in open question 35, plus up to three deputies | Receives alerts, runs this runbook, owns incidents |
| Technical contact | To be named | Patching and security incidents (open question 35 says one is still needed) |
| Quality Manager | Quality | Audit chain checks, Adobe Sign allowance, change approval, record retention |
| Database administrators | Entra group from deployment step 3c | Restores and investigations only; break-glass |
| Approvals for spend (more Adobe Sign agreements, bigger Azure SKUs) | **PJ Walters** | Not decided in this runbook |

## Routine checks

| When | Check | Section |
|---|---|---|
| Daily | Reminders job ran; no open alerts | [Reminders](#daily-training-reminders), [Monitoring](#monitoring-and-alerts) |
| Weekly | Audit chain verifies | [Audit chain](#audit-chain-verification) |
| Monthly | Adobe Sign allowance against Adobe Sign's own usage report; secret expiry dates; Azure Advisor and Defender recommendations | [Allowance](#adobe-sign-allowance), [Rotation](#secret-and-key-rotation) |
| Quarterly | Restore drill with evidence (spec Step 1, backup and continuity control) | [Backups](#backups-and-point-in-time-restore) |
| Yearly, or when due | Entra client secret, Adobe Sign client secret or integration key, Adobe Sign webhook token, SCIM token | [Rotation](#secret-and-key-rotation) |

Keep evidence (screenshots, command output, dates, who did it) in the quality records for the system itself.

## Monitoring and alerts

All container logs and job runs go to the Log Analytics workspace. Create the alerts below in Azure Monitor and
send them to one action group (Support Owner and deputies, email plus Teams or SMS). The thresholds are starting
points, not tested values; tune them after the first month.

| Alert | Signal | Starting point |
|---|---|---|
| API or web app down | Container app replica count, or failed readiness probes | No ready replica for 5 minutes |
| Server errors | HTTP 5xx from `veqms-api` and `veqms-web` | Any sustained run of 5xx; tune after a month |
| Reminders job failed | Job execution status for `veqms-reminders` | Any failed run |
| Migration failed | Job execution status for `veqms-migrate` | Any failed run (the deploy workflow also stops) |
| Database health | PostgreSQL CPU, storage used, failed connections | Storage nearing the limit; repeated failed connections |
| Key Vault denied | Key Vault diagnostic logs, `Forbidden` results | Any (usually a role assignment or secret name problem) |
| Adobe Sign webhooks refused, or the daily Adobe Sign sign-in failing | API logs ("Adobe Sign webhook notification refused"); the reminders job's `adobe-sign-sign-in` line | Any refused notification (wrong token or client ID); any failed sign-in (expired or revoked refresh token or key). Adobe disables a webhook after 72 hours of failed deliveries |
| Sign-in anomalies | Entra ID sign-in logs for the two app registrations | Per your Entra ID Protection policies |
| Azure service issues | Azure Service Health for UK South, PostgreSQL, Container Apps, Key Vault, Storage | Any |

Finding logs (*check* the table and column names; they depend on how the environment transactions logs to the workspace):

```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "veqms-api"
| where TimeGenerated > ago(1h)
| project TimeGenerated, Log_s
| order by TimeGenerated desc
```

Logs must never hold secrets, tokens or document contents. If you find any, treat it as an incident.

**Not in Phase 1:** the spec (Step 1, audit trail section) proposes writing the chain hash to a write-once container
every 15 minutes, an hourly verifier and a nightly full check that raise a security alert on a mismatch. Phase 1 has
only the on-demand check below. Until the anchors exist, run the weekly check and keep the residual risk on the risk
register.

## Daily training reminders

`veqms-reminders` runs at 06:00 UTC (06:00 in winter, 07:00 in summer, UK time). It transactions reminders for training
that is due and repeat notices for overdue training, using the reminder settings in VeQMS (Settings).

Check it ran:

```bash
az containerapp job execution list --name veqms-reminders --resource-group rg-veqms-prod --output table
```

If it failed, read its logs, fix the cause, then either start it by hand:

```bash
az containerapp job start --name veqms-reminders --resource-group rg-veqms-prod
```

or ask a Quality Manager to send them from VeQMS (`POST /api/v1/training/reminders`). *Check* before go-live
whether a second run on the same day transactions duplicate reminders.

## Backups and point-in-time restore

What exists:
- PostgreSQL automatic backups, kept 35 days, copied to the paired region (UK West). Point-in-time restore to any
  moment in that window.
- Blob storage: versioning, 30-day soft delete, and a time-based retention policy on `records`.
- Key Vault: 90-day soft delete and purge protection.

Recovery targets are **not agreed** (open question 24). Record them here once agreed and test against them.

**Restore the database to a point in time.** A restore always creates a **new** server; the live one is untouched.

```bash
az postgres flexible-server restore --resource-group rg-veqms-prod --name veqms-pg-restore-<yyyymmdd> --source-server <postgresServerName> --restore-time "<UTC time, e.g. 2026-11-19T09:30:00Z>"
```

*Check:* for a server in a private network, the restore needs the subnet and private DNS zone; confirm the options
(for example `--subnet`, `--private-dns-zone`) in the CLI reference. To restore into UK West after a regional
outage, use `az postgres flexible-server geo-restore` (*check* its options), and plan the network there in advance.

To put a restored server into service: stop the apps (scale to zero or deactivate the revision), point the apps and
jobs at the new server by redeploying the Bicep with the new server name, run the migrate job (it re-grants the
API's login), verify the audit chain, then start the apps. Record the data-loss window you accepted.

**Restore drill (quarterly).**
1. Restore to a new server at a known time (for example 09:00 UTC yesterday).
2. webhooks as a member of the database administrators group from inside the network (jump host or Bastion).
3. Verify the audit chain for each tenant. Row-level security is forced on every table, so your login needs
   membership of `veqms_readonly` and the tenant set for the session (*check* that the Azure administrator role can
   grant `veqms_readonly`; record the grant):
   ```sql
   set role veqms_readonly;
   select set_config('app.tenant_id', '<tenant id>', false);
   select * from app.verify_audit_chain();
   ```
   Expect `ok = true`.
4. Spot-check that records you know about exist (a document approved before the restore time, a training record).
5. Check that a signed PDF referenced in the restored database is still in blob storage.
6. Note how long the restore took and compare it with the agreed recovery time.
7. Delete the restored server, and record the drill with evidence.

**Recover a deleted or overwritten blob.** Use the previous version or undelete it within the 30 days (Storage
account → container → blob → Versions). Files under the retention policy can't be deleted or overwritten while it applies.

## Secret and key rotation

The apps read secrets from Key Vault by name. After you change a secret, **restart the active revision** so the
app picks up the new value (*check* whether your environment refreshes Key Vault references on its own):

```bash
az containerapp revision list --name veqms-api --resource-group rg-veqms-prod --query "[?properties.active].name" --output tsv
```

*Check:*

```bash
az containerapp revision restart --name veqms-api --resource-group rg-veqms-prod --revision <revision name>
```

The reminders job reads the same secrets each time it starts, so it needs no restart.

| Secret (Key Vault name) | Used by | How to rotate | Who notices if it goes wrong |
|---|---|---|---|
| `adobe-sign-client-secret`, `adobe-sign-refresh-token` (OAuth) | API, reminders job | See below | Sends and status checks fail with an authentication error; the daily job fails |
| `adobe-sign-integration-key` (instead of OAuth) | API, reminders job | See below | As above |
| `adobe-sign-webhook-token` | API | See below | Agreements stop completing in VeQMS until the daily status check |
| `entra-web-client-secret` | Web app | See below | Nobody can sign in |
| `scim-token` | API | See below | Provisioning errors in Entra ID |
| `session-secret` | Web app | Set a new random value and restart the web app | Everyone is signed out once (expected) |

**Adobe Sign OAuth credentials.** The refresh token stays valid while it's used (the daily job signs in every day);
Adobe expires it after 60 days unused, and revoking it revokes its access tokens.
1. To change the client secret or get a new refresh token, authorise the API application again as the sending account
   (see [06 · Adobe Sign](06-adobe-sign.md)) and store the new values in `adobe-sign-client-secret` and
   `adobe-sign-refresh-token`.
2. Restart the API revision and run the reminders job once: its `adobe-sign-sign-in` line must say `ok: true`.
3. Revoke the old refresh token in Adobe Sign.

**Adobe Sign integration key** (if used instead of OAuth). Create a new key with the same scopes, store it in
`adobe-sign-integration-key`, restart the API revision, check the daily sign-in, then revoke the old key.

**Adobe Sign webhook token.** The token is part of the webhook URL, so change both ends together.
1. Generate a new value (`openssl rand -hex 32`), store it in `adobe-sign-webhook-token` and restart the API revision.
2. In Adobe Sign, update the webhook's URL to `https://<api host>/webhooks/adobe-sign/<new token>`.
3. Check that the next agreement completes in VeQMS. Agreements that moved in between are picked up by the daily
   status check, or by *Check status with Adobe Sign* on the agreement.

**Entra web client secret.**
1. On the `VeQMS web` app registration add a new client secret. Note its expiry date in the calendar.
2. Store it in `entra-web-client-secret` and restart the `veqms-web` revision.
3. Sign in to check, then delete the old secret from the app registration.

**SCIM token.** The API accepts one token, so change both ends together, between provisioning cycles.
1. Generate a new value (`openssl rand -hex 32`) and store it in `scim-token`. Restart the API revision.
2. In the Entra enterprise application → Provisioning, paste the new secret token and **Test connection**.
3. Check the next provisioning cycle has no errors.

**If a secret leaks:** rotate it at once using the steps above, then follow [Incidents](#incident-handling).

## Adobe Sign allowance

Every agreement sent counts as one transaction against the yearly allowance (Settings: allowance, year start month, warning
level). The database refuses a transaction once the allowance is used up, and VeQMS notifies Quality Managers when the
remaining number falls to the warning level.

- See it: the transactions log (`GET /api/v1/agreements`), `GET /api/v1/signing/allowance`, or the `signing-transactions` report
  (xlsx or pdf).
- Monthly: compare the VeQMS count with Adobe Sign's own usage report for the account. Investigate any difference
  (for example agreements sent outside VeQMS from the same account).
- Running low: plan which approvals must go first, and raise buying more agreements early. Spend approval goes to
  **PJ Walters**. Only change the allowance in Settings after the Adobe Sign contract changes; the change is logged
  with old and new values.

## Audit chain verification

Every change writes a hash-chained entry to the audit log. The check recomputes the chain and reports the first
broken entry.

- Weekly, before every external audit, after every restore and after any incident: a Quality Manager runs
  `GET /api/v1/audit/verify` and records the result `{ ok, entries, brokenAt }`.
- Database administrators can run the same check with `app.verify_audit_chain()` (see the restore drill).

If `ok` is false:
1. Treat it as a **security incident**. Don't change or "repair" any data.
2. Note `brokenAt` and the time. Export the audit entries around it.
3. Restore a copy of the database from before the break (new server) and compare the entries.
4. Check Azure activity logs and PostgreSQL logs for administrator access in that period.
5. Report under [Incidents](#incident-handling) and record the outcome in the quality records.

## Leaver: revoke access now

For a normal leaver, disabling the account in Entra ID is enough: provisioning deactivates them in VeQMS, their open
training items close and their records stay. When access must end **immediately** (dismissal, suspected misuse):

1. **Entra ID:** disable the account and use **Revoke sessions** on the user. This stops new sign-ins.
2. **VeQMS:** a System Administrator opens Administration → Users → *Change access* and sets the person to
   **Revoked** (or **Left**), with the reason. This ends every VeQMS session at once (tokens issued before that
   moment are refused), closes their open training items and keeps their records. *End all sessions now* ends
   sessions without changing their access. Provisioning from Entra ID does the same when it deactivates the user,
   so **Provision on demand** in the Entra enterprise application is an alternative.
3. **Open approvals:** check the Approvals register for agreements waiting on them. Cancel and send again with a
   different signer (each new agreement uses a transaction).
4. **Ownership:** move their documents, CAPAs and tasks to someone else.
5. Record what you did and when.

*Check before go-live:* test this procedure end to end with a test user, including a request made with a token
issued before the revocation.

## Incident handling

An incident is anything that affects the confidentiality, integrity or availability of VeQMS or its records: an
outage, a failed audit chain check, a leaked secret, unexpected administrator access, data shown to the wrong person.

1. **Contain.** Rotate exposed secrets, revoke access, or take the app offline (scale `veqms-web` to zero) if records
   are at risk. Don't delete logs or data.
2. **Assess.** What happened, since when, which records and people are affected. Keep notes with UTC times.
3. **Personal data.** If personal data may be involved, tell the data protection lead at once. UK GDPR sets deadlines
   for reporting some breaches; the data protection lead decides on reporting. Questions on legal duties go to
   **PJ Walters**.
4. **Recover.** Fix the cause, restore from backup if needed, verify the audit chain.
5. **Close.** Raise a quality event and CAPA in VeQMS (or on paper if VeQMS is the thing that's down), with root cause
   and actions.

If VeQMS is down, people use the last approved PDFs. Keep a current export of the document register somewhere
people can reach without VeQMS.

## Data retention

- **No retention schedule is agreed yet.** It depends on open question 4 (which standards apply) and legal advice.
  The prototype's retention screen uses sample values only. Until a schedule is approved, keep everything.
- Quality records are never hard-deleted by the app: its database role can't delete them. (It can delete only
  replaceable configuration such as audience lists and group membership, and every such change is audited.)
- Signed PDFs and certificates sit in `records` under a time-based retention policy. The policy is **unlocked** at
  deployment. Once the schedule is approved and validation is complete, set the period and lock it. Locking can't be
  undone, and a locked period can only be extended.
- Database backups: 35 days. Log Analytics: 90 days (set in the Bicep). Change these only through change control.
- Legal hold: if records are needed for a dispute or investigation, a legal hold on the blob container stops changes
  regardless of the retention period. Agree with legal who can set and lift it.

## Change control for VeQMS itself

VeQMS holds controlled records, so changes to it follow your change-control procedure and keep it in a validated state.

1. **Raise** a change request in VeQMS for the change (code, configuration, infrastructure or settings), with the
   reason and a risk assessment.
2. **Build and test.** All code changes go through a pull request with at least one reviewer other than the author.
   CI (`platform-ci.yml`) must pass: type checks, unit tests, database tests and migrations.
3. **Validate** in a non-production environment: re-run the affected test scripts and the smoke checks in
   `05-deployment-azure.md`. Changes to signatures, training records, the audit trail or permissions need the full
   regression set.
4. **Approve.** The Quality Manager approves the change request and is a required reviewer on the GitHub
   `production` environment, so nothing deploys without that approval.
5. **Deploy** by merging to `main`. The workflow builds, migrates and rolls out; the commit hash is the image tag, so
   every running version traces back to a reviewed commit.
6. **Verify and close.** Run the smoke checks and the audit chain check, attach the evidence, close the change.

Emergency changes (security fixes) can deploy first with the Quality Manager's approval, but the change record,
review and evidence must be completed afterwards.

Configuration changed in the Azure portal by hand drifts from the Bicep. Make infrastructure changes in `infra/` and
deploy them; if an emergency fix was made in the portal, copy it into the Bicep the same week.

Monthly: apply Node base-image and dependency updates through the same process. Azure applies PostgreSQL minor
version updates during the server's maintenance window (*check* the window setting and choose a quiet time).
