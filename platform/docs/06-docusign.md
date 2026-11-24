# 06 · DocuSign approvals (Route 1)

What goes through DocuSign, how an envelope moves, and what to set up in the DocuSign account. The code is
`apps/api/src/services/envelopes.ts` (the workflow), `apps/api/src/integrations/docusign.ts` (the REST client and
the mock) and `packages/domain/src/docusign.ts` (the signing plan rules).

> Everything here that talks to DocuSign was written from DocuSign's public API design without a DocuSign account to
> test against. Check each item marked **verify** against DocuSign's current documentation and a developer (demo)
> account before go-live.

## What goes through DocuSign

| Record | Envelope | Signers, in order |
|---|---|---|
| Controlled document version (policies, procedures, vendor approvals, validation plans and reports, and the other document types) | One per version, sent when review is closed | 1 author (Authored) · 2 each reviewer (Reviewed, in parallel) · 3 QA approver (Approved) · 4 second QA approver if chosen |
| CAPA closure | One, after the effectiveness result is recorded as effective | 1 CAPA owner (Authored) · 2 QA approver (Approved) |
| Deviation closure without a CAPA | One, after the justification is written | 1 deviation owner (Authored) · 2 QA approver (Approved) |

Read-and-understood training does not go through DocuSign (Route 2, in the app).

## Rules

- **Segregation of duties.** The author and reviewers can't be the QA approver; the owner can't approve their own
  closure; approvers must hold Approver or Quality Manager. The plan shows problems before anything is sent; the API
  refuses the send and logs the refusal.
- **Verify before you send.** The sender ticks four checks against the PDF (footer, version, document ID, dates).
  The database refuses an envelope without them. A correction after sending costs a second send.
- **One open envelope per record.** Fixed once sent: subject, PDF, signers, sender.
- **Every send counts.** Each envelope sent takes the next number in the allowance year
  (`settings.docusign_allowance`, default 500, year starting in `allowance_year_start_month`). The database refuses
  sends beyond the allowance. Quality Managers are told when the remaining number reaches the warning level.
- **Declined or voided:** the record goes back to its owner with the reason (documents return to Draft). A corrected
  envelope is a new send and links to the one it replaces (`correction_of`).
- **Completed:** the API stores the signed PDF and the certificate of completion with SHA-256 hashes, writes one
  signature row per signer (`source = 'docusign'`, envelope ID, hash of the PDF signed), and then:
  documents become Effective (previous version Superseded, periodic review scheduled, author and reviewers get
  completed training records, the audience is allocated the new version); CAPAs close (and their source event);
  deviations close.

## How status reaches VeQMS

1. DocuSign Connect posts to `POST /webhooks/docusign` on the API's public address.
2. The API checks the HMAC signature over the raw body (`X-DocuSign-Signature-1` … against
   `DOCUSIGN_CONNECT_HMAC_KEYS`). Failures get 401 and nothing happens.
3. It finds the envelope through `envelope_directory`, records that the message arrived (with the message's
   SHA-256), then **reads the envelope and recipients from the DocuSign API** and applies that status. It never acts
   on the message body alone.
4. Repeats are harmless: a signer already signed or an envelope already final is left alone.
5. Fallbacks: anyone can press *Check status with DocuSign* on an envelope (`POST /envelopes/:id/refresh`), and the
   daily job checks every envelope that has been out for more than 24 hours.

## Setting up the DocuSign account

1. **Integration key** (an app in DocuSign's Apps and Keys page) with an RSA key pair. Put the private key in Key
   Vault (`DOCUSIGN_PRIVATE_KEY`). **Verify** the JWT claims and the `signature impersonation` scope.
2. **API user**: a DocuSign user the integration acts as (`DOCUSIGN_USER_ID`), with consent granted once for the
   integration key. Envelopes are sent as this user; the VeQMS sender is recorded in VeQMS.
3. **Account ID and base URI** (`DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URI`). Demo: `account-d.docusign.com` and
   `https://demo.docusign.net`. Production uses `account.docusign.com` and the base URI DocuSign gives your account.
   **Verify** these for your account.
4. **Part 11 module** switched on for the account, with signer re-authentication at signing and the signing reasons
   set up. **Verify** with DocuSign how the module presents the meaning; VeQMS also prints the meaning on the
   signature page and in each signer's note.
5. **Connect**: a configuration that posts JSON for envelope and recipient events to
   `https://<api address>/webhooks/docusign`, with HMAC signing on and at least one key. **Verify** the message
   format (VeQMS reads `data.envelopeId`).
6. **Allowance**: set `docusign_allowance` and the allowance year start month in VeQMS Settings to match the
   contract. Spend approval for more envelopes goes to **PJ Walters**.

## Development and UAT without DocuSign

`DOCUSIGN_MODE=mock` sends nothing. Each signer signs or declines in VeQMS when it is their turn
(`POST /envelopes/:id/mock/sign` and `/mock/decline`); the API generates stand-in signed PDFs and certificates marked
MOCK. Every other rule (order, segregation of duties, allowance, locks, completion) is the same code path as live.
The API refuses mock mode when `NODE_ENV=production`.

## KSTARRS history

Approvals made before go-live (`settings.docusign_go_live`) are imported as signatures with
`source = 'kstarrs'` and the versions marked `migrated_from = 'KSTARRS'`. See [08 · Migration](08-migration.md).
