# 07 · Testing and validation

## Automated tests

| Suite | What it proves | Run |
|---|---|---|
| Domain unit tests (`packages/domain/test`) | Signing plan and segregation of duties, allowance years, training status, Adobe Sign webhook checks, Excel writer, Word writer: 16 tests | `npm test --workspace @veqms/domain` |
| Database invariants (`packages/db/test/001_invariants.sql`) | Row-level security, no deletes, audit chain and tamper detection, IP and device kept apart and purged, training-record locks, import mode refused for the API, agreement rules, allowance, version locks (content, locked PDF, checks, retraining decision, change request), insert-only signatures, gap-free numbers, SharePoint (published file, sync runs, integrity alerts): 11 groups | `npm run db:test` (needs `psql` and PostgreSQL 16) |
| API flow (`apps/api/test/flow.test.ts`) | The services against a freshly seeded database as `veqms_app`: the amendment flow (change request, locked PDF and its four checks at submit, review, approval in VeQMS with the retraining decision, returns to the author, the agreement sent on the last approval), signing in order, complete, cancel, decline, correction transactions, no-retraining versions, closures, status sync as from Adobe Sign (including a rejection reported as cancelled), open-before-confirm, quiz, locks, corrections, leavers, email queue, allowance refusal, audit chain and anchor; SharePoint in mock mode (publishing, superseded files, the sync, integrity alerts, the hash check, failed publishing) and the live Word path with Graph faked (Word file, conversion with the signature page, change checks), and a restart when a change token expires: 129 checks | `DATABASE_URL=… npm test --workspace @veqms/api` after migrate and seed |
| Config (`apps/api/test/config.test.ts`) | The rules for each stage: development may simulate everything; staging may keep Adobe Sign and SharePoint as placeholders but needs Entra; production needs both live: 10 checks | `npm test --workspace @veqms/api` (no database needed) |
| Webhook route (`apps/api/test/webhook.test.ts`) | The Adobe Sign webhook through Fastify in live mode with a faked Adobe client: secret URL, client ID check, the echo Adobe requires, queueing with de-duplication, and that the queue worker only reads the status from Adobe Sign: 12 checks | as the API flow test |
| UAT in the browser (`e2e/tests/uat.spec.ts`) | The ten UAT scenarios below, through the web app as each persona, against the Docker stack with Adobe Sign and SharePoint in mock mode: 10 tests | `docker compose up --build`, then `cd e2e && npm ci && npx playwright install chromium && npx playwright test` |

CI (`.github/workflows/platform-ci.yml`) runs all of them on every push: the first three with a PostgreSQL 16 service,
the browser tests in a second job against `docker compose`. Both the API flow test and the browser tests change data,
so each needs a freshly seeded database.

## What has actually run so far

Phase 1 was first written in a sandbox without npm access. It has since been installed and built with the real
packages (Node 22, TypeScript 5.9, Next.js 16.4, Fastify 5.12, zod 4.6, pg 8), and `package-lock.json` is committed.

- **Passing with the real packages, on a clean copy from the lockfile:** type-check; build (including `next build`);
  the domain tests (16 of 16); the database invariants on PostgreSQL 16 (all 11 groups); migrate twice (the second run
  is a no-op) and seed; the API flow test (129 of 129) and the webhook route test (12 of 12). These are the steps CI runs.
- **CI on GitHub:** both jobs (checks, and the browser tests against `docker compose`) passed on the pull request.
- **Bicep:** `infra/main.bicep` compiles and lints with no errors or warnings (Bicep CLI 0.49.2). It has not been
  deployed.
- **Docker:** both images build, and `docker compose up --build` starts the database, runs the migrations and seed,
  and serves the API and web app.
- **In a browser:** the ten UAT scenarios pass against that stack (Playwright, Chromium), and the audit chain
  verifies afterwards. A crawl of every page and every linked record as each of the 12 personas (1,086 page loads)
  found no server errors after the fixes below. One crawl run logged a 400 on a sub-resource for one persona on two
  pages, and one React hydration warning; neither came back on a rerun, and the cause isn't known.
- **Not run yet:** deploying the Bicep, the deploy workflow, Microsoft Entra sign-in, Adobe Sign live
  mode, Microsoft Graph email, Azure Blob storage. Firefox, Safari and screen readers are untested.

Found and fixed during that work:

- Type-checking needed `@veqms/domain` and `@veqms/db` built first; `npm run typecheck` now builds them.
- The API process exited when the database dropped an idle connection (restart or failover). The pool now logs it
  and opens a new connection.
- In Docker, the API couldn't write to its storage volume, so every Adobe Sign send failed. The image now creates the
  folder for the `node` user.
- A document's Training tab crashed for anyone who isn't its owner or a training manager. It now explains who can
  see the records.
- A revoked user got a blank error page. They are now signed out and told their access has been removed.
- The closure pages showed nothing once a closure was sent. They now show the agreement, let the signer sign in mock
  mode, and show the closed state. The Quality page lists CAPAs and quality events.
- Closing a CAPA closed its source quality event without an audit entry. It is now logged with the previous state.
- Filtering training records by Withdrawn, Corrected or Superseded found nothing unless "include earlier versions"
  was ticked.
- Concurrent queries on one transaction (deprecated in `pg`, removed in `pg` 9) now run one after another.
- The development sign-in lists all twelve demo people, so every UAT step can be done on screen (Omar signs in
  scenario 2).

Then upgraded to Next.js 16 and zod 4 to clear two package advisories (`postcss` through `next` 15, and a
memory-exhaustion issue in `zod` 3); `npm audit` reports none. The upgrade renamed `middleware.ts` to `proxy.ts`
(Next.js 16), and the API now checks IDs with `z.guid()`: zod 4's `z.uuid()` refuses UUIDs whose version bits aren't
RFC 9562 ones, which PostgreSQL accepts (the demo seed has many). Every check above passed again after the upgrade.
Showing a send page that segregation of duties blocks is now logged (UAT scenario 1).

Then switched from DocuSign to Adobe Sign (every signature except read-and-understood training). The mock path, which
the tests and UAT use, is the same code as live apart from the Adobe Sign client. All the checks above passed again
after the switch. The live Adobe Sign client has not run against Adobe Sign: see the "Verify before go-live" list in
[06 · Adobe Sign](06-adobe-sign.md).

Then changed the document flow to PJ Walters' amendment flow of 24 November 2026: a change request first; at submit
the PDF is made, hashed and locked, and the author checks it; review, then approval in VeQMS with the retraining
decision; the agreement goes to Adobe Sign on the last approval; anyone on it can return the draft before signing. The
send page is gone. The invariants, the API flow test (109 checks at that point) and the nine browser scenarios (1 to 3
rewritten for the new flow) passed. If Adobe Sign can't be reached when the last approver approves, the approval rolls back and they
approve again later; the browser shows the error.

Then added a staging stage (`VEQMS_STAGE=staging`, Bicep `deploymentStage`): the built API started with
`NODE_ENV=production` and the placeholders, answered `/ready`, and the three jobs exited cleanly; with the same
settings as production it refused to start. The staging banner hasn't been seen in a browser (staging needs real
Entra sign-in).

Then made SharePoint the file store ([10 · SharePoint](10-sharepoint.md)): Word drafts, publishing to the controlled
library, the delta sync with integrity alerts, the nightly hash check and the import job. Mock mode runs in the tests
and UAT (scenario 10 added). The live Graph calls have not run against SharePoint; the Word file VeQMS creates was
opened in LibreOffice, not Word. The Bicep (new `veqms-sharepoint` job and settings) compiles and lints.

## Before go-live

1. **CI green** with real packages, lockfile committed.
2. **UAT in mock mode** on Azure: walk the scenarios below as each persona.
3. **Adobe Sign developer account**: switch to live mode against it; send, sign, decline and cancel real agreements;
   check the webhook, the signed PDF and the audit report, and every item marked **verify** in
   [06 · Adobe Sign](06-adobe-sign.md).
4. **Entra**: sign in, token refresh, revoked user, SCIM provisioning with Microsoft's SCIM validator.
5. **Restore drill** (runbook) and **audit chain check** after the restore.
6. **Penetration test** (Step 3 Gate 2).
7. **Validation** (below), because Adobe Sign approvals now produce Part 11 records.

## UAT scenarios (Phase 1)

Use the demo seed (`npm run db:seed`, never in production). Personas sign in with the development picker.

1. Victoria tries to submit POL-003, which she wrote, with herself as QA approver. The submit page doesn't offer her.
   If the form is sent anyway (the browser test does this), the API refuses it (segregation of duties) and the refusal
   is logged (`sod.block`, "Submit refused").
2. Carrie makes the VP-001 PDF, opens it, ticks the four checks and submits. Omar marks it reviewed. Victoria approves
   (retraining needed), and the agreement goes to Adobe Sign at once. Carrie signs, then Omar, then Victoria. VP-001
   becomes Effective and its change request CR-019 closes; Carrie and Omar have completed training records; the IT
   team has VP-001 to read.
3. Jim cancels POL-004's agreement with a reason; it returns to Draft. He makes the PDF again and resubmits; Carrie
   reviews; PJ returns it to Jim with a reason. Jim checks the PDF again and resubmits; Carrie reviews; Victoria and PJ
   approve with no retraining (each gives a reason), which sends a corrected agreement (a new transaction, linked to
   the cancelled one). Carrie declines with a reason; POL-004 returns to Draft again.
4. Daniel reads SOP-012, answers the quiz and confirms. He can't confirm twice. Victoria corrects his record with a
   reason and asks him to retrain: the original stays, marked Corrected.
5. Carrie records the CAPA-005 effectiveness result and sends the closure; Carrie and Victoria sign; CAPA-005 and
   QE-013 close.
6. Louise writes the QE-017 justification and sends the closure; Victoria declines; Louise resends; both sign;
   QE-017 closes.
7. Lucy (System Administrator) revokes Jake's access: his sessions end and his open training closes. Lucy can't give
   herself Approver.
8. Fraser (auditor) opens the audit trail and verifies the chain; any change he tries is refused.
9. Export each report as Excel and PDF; each shows when and by whom it was generated, and the export is logged.
10. Victoria syncs SharePoint: VP-001 v1.0 is published to the controlled library. She simulates an outside edit of
    its file (mock only) and syncs again: an integrity alert appears. She resolves it with a note; the alert and its
    resolution are in the audit trail.

## Validation (computerised system)

Adobe Sign approvals with its Bio-Pharma settings make VeQMS a regulated system for those records. A proportionate
approach, to agree with your validation lead (the GAMP 5 categories and the depth of testing are their call):

- **Validation plan** (VP-001 in the demo data shows the shape) naming the intended use, the regulated records
  (Route 1 approvals, closures, the audit trail, training records) and the approach.
- **Requirements and traceability:** `../specs/QMS_Build_Prompt.md`, the signatures and training brief, and this
  documentation set, each traced to a test (the automated suites above, plus the UAT scenarios as scripted tests).
- **Supplier assessment** for Adobe Sign, Microsoft (Azure, Entra) and the hosting arrangements.
- **Adobe's material:** use Adobe's 21 CFR Part 11 validation pack, and its Part 11 and Annex 11 handbook, in IQ, OQ
  and PQ for the Adobe Sign part (the pack assumes Acrobat Sign Enterprise with SAML single sign-on).
- **IQ:** the deployment guide's smoke checks and the infrastructure as deployed (Bicep what-if output, image tags).
- **OQ:** the automated suites run against the deployed environment, plus the Adobe Sign live tests.
- **PQ:** the UAT scenarios with real users and real documents.
- **Validation report** and release, then change control for every later change (runbook, "Change control for
  VeQMS itself").

The cost and effort of validation were not in the Step 1 estimate (threat model R8). Pricing approval goes to
**PJ Walters**.
