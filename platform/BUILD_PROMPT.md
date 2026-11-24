# Build prompt: VeQMS full-stack platform, from Phase 1 to go-live

> **How to use this prompt.** Open the repository in Claude Code (or brief a developer with it) and paste everything
> below the line. It picks up where the Phase 1 build stopped. Fill in or confirm every item marked **[DECIDE]**
> before the phase that needs it. The original brief is `../specs/QMS_Build_Prompt.md`; this prompt narrows it to
> the live build and records what is already decided.

---

## 1. Your role and how to work

You are a senior full-stack engineer working on VeQMS, an electronic quality management system for a regulated
organisation. The code is in `platform/` (this folder). The clickable prototype in `../veqms/` is the reference for
screens and flows. The specs in `../specs/` win when anything disagrees; ask before changing a confirmed answer.

Work phase by phase (section 6). For each phase: propose the plan, wait for approval, build it with migrations,
tests and docs, run every check (section 5), and report honestly what ran and what didn't.

Rules:
- Don't invent library functions, API endpoints or settings. If you're not sure something exists or how it behaves
  (Next.js, Fastify, zod, pg, pdf-lib, Adobe Sign, Microsoft Graph, Entra ID, Azure), say so and check the current
  official documentation first. Places in the code marked **verify** still need that check.
- Don't describe anything as "compliant" (ISO 27001, Part 11). Say what a feature supports and produce evidence.
- When a requirement is unclear, ask rather than assume. Flag assumptions in the change description.
- Write in British English, plainly. No marketing language in the UI or the docs.
- Questions about HR policy, legal terms or pricing go to **PJ Walters**; don't answer them yourself.

## 2. What exists now (end of Phase 1)

| Part | State |
|---|---|
| Database (`packages/db`) | 47 tables for every module; row-level security; append-only hash-chained audit log; insert-only signatures; locked training records; Adobe Sign agreement and allowance rules; demo seed; invariant tests. **Run and passing** on PostgreSQL 16 |
| Domain rules (`packages/domain`) | Permissions, signing plan, allowance years, training status, Adobe Sign webhook checks, Excel and Word writers. **16 unit tests passing** |
| API (`apps/api`) | Fastify 5. Sign-in (Entra ID, development personas), documents, the Adobe Sign route (send, status sync, completion, cancel, decline, mock signing), CAPA and deviation closure, training (allocation, confirmation, quiz, corrections, matrix, reminders), approvals register and transactions log, reports (Excel, PDF), users and roles, settings, audit trail, SCIM, daily job, audit anchors, SharePoint (Word drafts, publishing, delta sync, integrity alerts, hash check, import). **Built with the real packages; API flow test passing (128 checks)** |
| Web (`apps/web`) | Next.js 16. Sign-in, Today, documents (list, new, edit or open in Word, submit with the locked PDF and its checks, review, approve with the retraining decision), approvals, agreement view with mock signing, quality (CAPA and event lists, closures), training (mine, confirm, matrix, records), administration (audit, SharePoint, settings, users and roles). **Built; the ten UAT scenarios pass in a browser** (`e2e/`, Playwright) |
| Azure (`infra`, workflows) | Bicep for UK South, Dockerfiles, CI and deploy workflows, deployment guide, runbook. **Dockerfiles and `docker compose` run locally; Bicep and the deploy workflow never run** |

Not run yet: Microsoft Entra sign-in, live Adobe Sign, live SharePoint, Microsoft Graph email, Azure Blob storage, anything in Azure.

## 3. Rules to keep (don't break these)

1. **The database enforces compliance rules.** Don't move a rule from SQL into the API only. New tenant tables get
   `tenant_id`, row-level security, grants and an invariant test.
2. **One request, one transaction** (`withTenant`). Audit entries are written in the same transaction as the change.
   Refusals that must be logged use `logged(...)` so the error handler writes them after the rollback.
3. **State changes go through services**, which write the audit entry and fire automation. Routes only parse,
   check permissions and call services.
4. **Every signature goes through Adobe Sign, except read-and-understood training.** Approvals of controlled
   documents, CAPA and deviation closures (built), and in later phases change requests (plan approval, sign-off that the
   changes were made), periodic review outcomes and every other sign-off: one agreement per sign-off, all signers in
   order, a segregation-of-duties check in the signing plan, every agreement one transaction against the allowance.
   Never change those records' state by hand: the agreement completing does it. Read-and-understood training stays in
   the app and is a training record, not a signature. The database allows no other signature source.
   Documents follow PJ Walters' amendment flow (24 November 2026): change request first; at submit the PDF is made,
   hashed and locked, and the author makes the four checks on it; review, then approval in VeQMS with the retraining
   decision; the last approval sends the agreement; anyone on it can return the draft before signing. What is signed
   and published is the locked PDF.
5. **Training records are locked once completed.** Only the trainee confirms; the system sets dates; corrections are
   new records; audience changes are logged with old and new values.
6. **The webhook notifies, the API confirms.** Never act on a webhook body alone.
7. **The browser never calls the API.** The web app calls it from the server with the user's token. Hide buttons
   by permission, but the API checks every permission again.
8. **No secrets in code.** Key Vault in Azure, `.env` locally (never committed).
9. **TypeScript that Node can strip:** no enums, no namespaces with values, no parameter properties in `packages/*`
   and `apps/api` (`erasableSyntaxOnly`). Relative imports end in `.ts`.

## 4. First tasks (before any new feature)

Tasks 1 to 4 are done (see `docs/07`, "What has actually run so far"); CI has still to run on GitHub for the first time.

1. ~~`npm install` at `platform/`, commit `package-lock.json`.~~ Done.
2. ~~`npm run typecheck` and `npm run build`; fix whatever the real package types report.~~ Done.
3. Run CI (`.github/workflows/platform-ci.yml`) to green: domain tests, database invariants, migrate and seed, API
   flow test, and the browser tests (`e2e` job). All pass locally; check the first run on GitHub.
4. ~~`docker compose up --build`, walk the UAT scenarios as each persona, fix what fails, add a Playwright test for
   each scenario.~~ Done: `e2e/tests/uat.spec.ts`.
5. Deploy to a non-production Azure subscription by `docs/05-deployment-azure.md`; fix what the tools reject.
6. Switch Adobe Sign to live against an Adobe Sign developer account and test the route end to end (`docs/06-adobe-sign.md`).

## 5. Checks for every change

- `npm run typecheck`, `npm test`, `npm run db:test` all pass; CI is green.
- New workflow paths have tests for the happy path and for each refusal (permissions, segregation of duties, locks).
- The audit chain verifies after the tests (`app.verify_audit_chain()`).
- Docs updated: `docs/03-api.md` for API changes, `docs/02-data-model.md` for schema changes.
- Nothing personal or client-identifying in sample data unless supplied for that purpose.

## 6. Phases

The spec's phases (`../specs/QMS_Build_Prompt.md` §13) map to the live build like this. Gate 2 (MVP go-live) comes
after Phase 1 and its security testing, because real quality records go in from then.

| Live build | Scope | From the spec |
|---|---|---|
| **Phase 1** (built) | Foundation, documents with the Adobe Sign route, read-and-understood training, approvals register, audit, reports, users and roles, SCIM; SharePoint as the file store (Word drafts, publishing, delta sync, integrity alerts, import; moved here from Phase 4 by PJ Walters' decisions of 24 November 2026) | Phases 1, 3; parts of 2, 6 and §7.3 |
| **Phase 2** | Change control and periodic reviews | Phase 4 |
| **Phase 3** | Observations, quality events and full CAPA screens (root cause, actions, evidence) | Phase 5 |
| **Phase 4** | Templates management; Microsoft Teams notifications | Phase 2 remainder, §7.4 |
| **Phase 5** | Analytics and dashboards | Phase 6 remainder |
| **Phase 6** | Mobile app (React Native with Expo) | Phase 7 |
| **Phase 7** | Hardening and full go-live (Gate 3) | Phase 8 |

### Phase 2: change control and periodic reviews
Tables exist: `change_requests`, `cr_actions`, `periodic_reviews`, `record_links`. Phase 1 already opens a minimal
change request for every new document or version (`document_versions.change_request_id`) and closes it when that
version is Effective; Phase 2 adds the change control screens and approvals around it. Build API routes, services and
screens following the prototype (`../veqms/js/views/changes.js`, `reviews.js`). Decided: change request approvals,
sign-off of the changes made, and periodic review outcomes are Adobe Sign agreements (each uses a transaction): add
their record types to `agreements.record_type`, a signing plan for each in `packages/domain/src/signing.ts`, and reuse
the send, status and completion code.
Acceptance: a change request can't be implemented before approval; every action has an owner and due date; a
periodic review is created when a document becomes effective (already built) and its outcome (no change, revise,
retire) drives the next step; every state change is in the audit trail.

### Phase 3: observations, quality events and CAPA
Tables exist: `observations`, `quality_events`, `capas`, `capa_actions`, `evidence`. Phase 1 already closes CAPAs
and deviations through Adobe Sign; build the rest of their lifecycle and the screens (`../veqms/js/views/quality.js`).
Acceptance: closing a quality event without a CAPA needs a signed justification (deviations: Adobe Sign, built);
CAPA actions lock when execution starts; the effectiveness check is due on the set date and escalates when late;
evidence files are scanned before anyone can open them (**[DECIDE]** the scanning service; Step 3 T15).

### Phase 4: templates and Teams
SharePoint publishing and import moved to Phase 1 (see [10 · SharePoint](docs/10-sharepoint.md); its live Graph calls
still need the checks listed there). Acceptance (spec §15): reviewers get a Teams message as well as email and
in-app; if an integration is down, the core keeps working, failed items queue for retry (`dead_letters`) and admins
are alerted. Use least-privilege permissions (mailbox-scoped `Mail.Send`). **Verify** every Graph endpoint.

### Phase 5: analytics
Dashboards from the prototype (`../veqms/js/views/analytics.js`): training compliance, overdue items, document ages,
CAPA ageing, Adobe Sign allowance use. Every figure must trace to records a user can open. Exports stamped like the
Phase 1 reports.

### Phase 6: mobile
Scope from spec §9 and Step 1: My Work, read-and-understood confirmation, notifications. **[DECIDE]** distribution
(public stores with tenant-limited sign-in, or Intune). **Verify** Expo support for certificate pinning and root
detection before committing (Step 3 R9).

### Phase 7: hardening and go-live
Penetration test with high and critical findings fixed; restore test within the RTO; audit-tamper test raises an
alert; leaver test meets the target; performance test; validation report signed (see `docs/07`); ISMS evidence pack.

## 7. Decisions still open

From the specs and the Phase 1 build. Ask the owner before the phase that needs each one:

- RPO and RTO; retention schedule and the storage immutability period (Bicep default is a placeholder).
- Two-person rule for role grants (R3); audit anchoring interval (R4; built with Step 1's 15 minutes as the default);
  leaver and availability targets (R5, R6).
- Retention period for IP addresses and devices in the audit trail (built with 90 days as the default).
- Who holds System Administrator in production and who signs UAT (R2); independent code reviewer (R1).
- Whether titles of Restricted documents may appear in email.
- Whether a first effective version should be numbered 1.0 (the prototype and Phase 1 keep 0.1).
- Validation approach and who leads it (Part 11 records are now in scope).
- Azure, Adobe Sign and validation costs: pricing approval goes to **PJ Walters**.
