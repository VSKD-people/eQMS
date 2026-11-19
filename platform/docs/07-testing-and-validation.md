# 07 · Testing and validation

## Automated tests

| Suite | What it proves | Run |
|---|---|---|
| Domain unit tests (`packages/domain/test`) | Signing plan and segregation of duties, allowance years, training status, Connect HMAC, Excel writer: 15 tests | `npm test --workspace @veqms/domain` |
| Database invariants (`packages/db/test/001_invariants.sql`) | Row-level security, no deletes, audit chain and tamper detection, training-record locks, import mode refused for the API, envelope rules, allowance, version locks, insert-only signatures, gap-free numbers: 10 groups | `npm run db:test` (needs `psql` and PostgreSQL 16) |
| API flow (`apps/api/test/flow.test.ts`) | The services against a freshly seeded database as `veqms_app`: send, sign in order, complete, void, decline, correction sends, closures, Connect-style status sync, training confirmation, quiz, locks, corrections, leavers, email queue, allowance refusal, audit chain: 68 checks | `DATABASE_URL=… npm test --workspace @veqms/api` after migrate and seed |

CI (`.github/workflows/platform-ci.yml`) runs all of them on every push, with a PostgreSQL 16 service.

## What has actually run so far

The build sandbox had no access to the npm registry, so no package could be installed. In that sandbox:

- **Ran for real:** the domain tests (15 of 15 pass); the database migrations, seed and invariant tests on
  PostgreSQL 16 (all 10 groups pass); the API flow test (68 of 68 pass) and a route-level check (1,068 requests, every
  read route as each of 12 personas, no server errors; plus permissions, refusals reaching the audit trail, the
  webhook HMAC check and SCIM provisioning: 24 checks). For those two, a test-only Postgres client and a miniature
  stand-in for Fastify replaced the npm packages; the API code, SQL and database were real.
- **Type-checked only**, against hand-written stand-ins for the package types: the API and the web app. The first
  `npm install` and `npm run typecheck` in CI may still find mismatches with the real package types.
- **Not run at all:** the web app in a browser, the Docker images, the Bicep, the deploy workflow, Microsoft Entra
  sign-in, DocuSign live mode, Microsoft Graph email, Azure Blob storage.

So the first job is: run CI, commit `package-lock.json`, fix what the real compilers report, then deploy to a
non-production subscription.

## Before go-live

1. **CI green** with real packages, lockfile committed.
2. **UAT in mock mode** on Azure: walk the scenarios below as each persona.
3. **DocuSign demo account**: switch to live mode against the demo environment; send, sign, decline and void real
   envelopes; check Connect, the signed PDF and the certificate.
4. **Entra**: sign in, token refresh, revoked user, SCIM provisioning with Microsoft's SCIM validator.
5. **Restore drill** (runbook) and **audit chain check** after the restore.
6. **Penetration test** (Step 3 Gate 2).
7. **Validation** (below), because DocuSign approvals now produce Part 11 records.

## UAT scenarios (Phase 1)

Use the demo seed (`npm run db:seed`, never in production). Personas sign in with the development picker.

1. Victoria tries to send POL-003 for approval with herself as QA approver: refused (segregation of duties); the
   refusal is in the audit trail.
2. Victoria sends VP-001: verify the PDF, tick the four checks, send. Carrie signs, then Omar, then Victoria. VP-001
   becomes Effective; Carrie and Omar have completed training records; the IT team has VP-001 to read.
3. Jim voids POL-004 with a reason; it returns to Draft. He resubmits, Carrie reviews, Jim sends a corrected
   envelope (a new send, linked to the voided one). Carrie declines with a reason; POL-004 returns to Draft again.
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

## Validation (computerised system)

DocuSign approvals with the Part 11 module make VeQMS a regulated system for those records. A proportionate
approach, to agree with your validation lead (the GAMP 5 categories and the depth of testing are their call):

- **Validation plan** (VP-001 in the demo data shows the shape) naming the intended use, the regulated records
  (Route 1 approvals, closures, the audit trail, training records) and the approach.
- **Requirements and traceability:** `../specs/QMS_Build_Prompt.md`, the signatures and training brief, and this
  documentation set, each traced to a test (the automated suites above, plus the UAT scenarios as scripted tests).
- **Supplier assessment** for DocuSign, Microsoft (Azure, Entra) and the hosting arrangements.
- **IQ:** the deployment guide's smoke checks and the infrastructure as deployed (Bicep what-if output, image tags).
- **OQ:** the automated suites run against the deployed environment, plus the DocuSign live tests.
- **PQ:** the UAT scenarios with real users and real documents.
- **Validation report** and release, then change control for every later change (runbook, "Change control for
  VeQMS itself").

The cost and effort of validation were not in the Step 1 estimate (threat model R8). Pricing approval goes to
**PJ Walters**.
