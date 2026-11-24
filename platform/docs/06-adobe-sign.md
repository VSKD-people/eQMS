# 06 · Approvals in Adobe Sign

What goes through Adobe Sign (Adobe Acrobat Sign), how an agreement moves, and what to set up in the Adobe Sign
account. The code is `apps/api/src/services/agreements.ts` (the workflow), `apps/api/src/integrations/adobesign.ts`
(the REST API v6 client and the mock), `apps/api/src/routes/webhooks.ts` (webhooks), and
`packages/domain/src/signing.ts` and `webhook.ts` (the signing plan rules and status mapping).

> **Not yet tested against Adobe Sign.** The live client was written from Adobe's published developer guides; the
> build environment could not open Adobe's API reference and had no Adobe Sign account. Every item marked **verify**
> must be checked against Adobe's current v6 API reference and a developer account before go-live (section "Verify
> before go-live" below). Mock mode, which the tests and UAT use, does not depend on any of it.

## The rule

Every signature goes through Adobe Sign, except read-and-understood training. Training stays in VeQMS: the trainee
confirms under their Microsoft 365 sign-in and the record is locked; it is a training record, not an electronic
signature, and not a Part 11 signature. The database enforces the rule: a signature row's `source` can only be
`adobe_sign`, or `kstarrs` for approvals migrated from the old system.

| Record | Agreement | Signers, in order | Built |
|---|---|---|---|
| Controlled document version (policies, procedures, vendor approvals, validation plans and reports, and the other document types) | One per version, sent when review is closed | 1 author (Authored) · 2 each reviewer (Reviewed, in parallel) · 3 QA approver (Approved) · 4 second QA approver if chosen | Phase 1 |
| CAPA closure | One, after the effectiveness result is recorded as effective | 1 CAPA owner (Authored) · 2 QA approver (Approved) | Phase 1 |
| Deviation closure without a CAPA | One, after the justification is written | 1 deviation owner (Authored) · 2 QA approver (Approved) | Phase 1 |
| Change requests: plan approval, and sign-off that the changes were made | One per sign-off | To be set in Phase 2 | Phase 2 |
| Periodic review outcomes, CAPA plans, observation and quality event closures, and any other sign-off | One per sign-off | To be set in the phase that builds each | Phases 2 and 3 |

Each new kind of sign-off adds its record type to `agreements.record_type` and a signing plan in
`packages/domain/src/signing.ts`, and uses the same send, status and completion code.

## Rules

- **Segregation of duties.** The author and reviewers can't be the QA approver; the owner can't approve their own
  closure; approvers must hold Approver or Quality Manager. The plan shows problems before anything is sent, and
  showing a blocked plan is logged (`sod.block`). If the send is attempted anyway, the API refuses it and logs that too.
- **Verify before you send.** The sender ticks four checks against the PDF (footer, version, document ID, dates).
  The database refuses an agreement without them. A correction after sending uses a second transaction.
- **One open agreement per record.** Fixed once sent: name, PDF, signers, sender.
- **Every agreement is one transaction.** Adobe counts one transaction per agreement sent, whatever the number of
  signers. Each agreement takes the next number in the allowance year (`settings.signing_allowance`, default 500,
  year starting in `allowance_year_start_month`), and the database refuses one beyond the allowance. Quality Managers
  are told when the remaining number reaches the warning level. The 500 is a placeholder: set it to the contract's
  number (to be confirmed; pricing goes to **PJ Walters**).
- **Declined or cancelled:** the record goes back to its owner with the reason (documents return to Draft). A corrected
  agreement is a new transaction and links to the one it replaces (`correction_of`).
- **Completed:** the API stores the signed PDF and Adobe Sign's audit report with SHA-256 hashes, writes one signature
  row per signer (`source = 'adobe_sign'`, agreement ID, hash of the PDF signed), and then: documents become Effective
  (previous version Superseded, periodic review scheduled, author and reviewers get completed training records, the
  audience is allocated the new version); CAPAs close (and their source event); deviations close.
- **Signature meaning.** Authored, Reviewed or Approved is printed next to each signer's signature field and listed in
  the signing order. In Adobe Sign, the Bio-Pharma settings ask each signer for a reason for signing; set the reasons
  to these three meanings (see below).

## How status reaches VeQMS

1. Adobe Sign sends a webhook notification to `POST /webhooks/adobe-sign/<token>` on the API's public address.
   `<token>` is `ADOBE_SIGN_WEBHOOK_TOKEN`, a long random value.
2. Adobe Sign does not sign its notifications. The API accepts one only on the secret URL and, when configured, with
   the expected `X-AdobeSign-ClientId`. Anything else gets a plain 404. Every accepted request is answered with the
   client ID echoed back (header and JSON body), which Adobe Sign requires; this includes the "verification of
   intent" GET Adobe sends when the webhook is created.
3. The API finds the agreement through `agreement_directory`, records that a notification arrived (with the payload's
   SHA-256), then **reads the agreement and its events from the Adobe Sign API** and applies that status. It never acts
   on the notification body alone.
4. Adobe Sign reports both a cancellation and a signer's rejection as `CANCELLED` (newer accounts: `ABORTED`). A
   `REJECTED` event in the agreement's history makes it a decline, with the signer's comment as the reason. `EXPIRED`
   is handled like a cancellation.
5. Repeats are harmless: a signer already signed or an agreement already final is left alone. Adobe Sign retries a
   failed delivery 15 times over 72 hours and then disables the webhook, so watch the API's error rate (runbook).
6. Fallbacks: anyone can press *Check status with Adobe Sign* on an agreement (`POST /agreements/:id/refresh`), and the
   daily job checks every agreement that has been out for more than 24 hours.

## Setting up the Adobe Sign account

1. **Plan.** Adobe's guidance for FDA-regulated customers needs a Business or Enterprise plan; Adobe's validation
   pack assumes Enterprise with single sign-on. Confirm the plan and the yearly transactions with **PJ Walters**.
2. **Data centre.** Adobe Sign accounts live in one data centre (for example EU1 Frankfurt or EU2 Amsterdam). No UK
   data centre was found in Adobe's list. Signed documents and audit reports are held by Adobe in that data centre as
   well as in VeQMS's UK South storage. **Decide** whether that is acceptable before go-live.
3. **A group for VeQMS agreements with the Bio-Pharma settings on:** identity check when the signer signs (Adobe Sign
   login, email one-time code or SMS) and a required reason for signing, with Authored, Reviewed and Approved as the
   reasons. Agreements are sent from this group. **Verify** whether the API can pick the group per agreement; until
   then, the account the integration uses must send from it.
4. **API access.** Either:
   - **OAuth** (`ADOBE_SIGN_AUTH=oauth`): create an API application, authorise it once as the sending account with
     the `agreement_read`, `agreement_write`, `agreement_send` and `webhook_read`/`webhook_write` scopes, and store the
     client secret and refresh token in Key Vault. Set `ADOBE_SIGN_CLIENT_ID` and `ADOBE_SIGN_API_ACCESS_POINT` (the
     account's API address, returned with the token). Adobe expires a refresh token after 60 days unused; the API
     uses it whenever agreements are moving, and the daily job signs in once a day so it stays alive (a failed sign-in fails the job).
   - **Integration key** (`ADOBE_SIGN_AUTH=integration-key`, Enterprise only): create one with the same scopes and
     store it in Key Vault. The API address is discovered with `GET /api/rest/v6/baseUris` if not set.
5. **Webhook**: account or group scope, events `AGREEMENT_ACTION_COMPLETED`, `AGREEMENT_WORKFLOW_COMPLETED`,
   `AGREEMENT_REJECTED`, `AGREEMENT_RECALLED` and `AGREEMENT_EXPIRED`, URL
   `https://<api address>/webhooks/adobe-sign/<ADOBE_SIGN_WEBHOOK_TOKEN>`. Set `ADOBE_SIGN_WEBHOOK_CLIENT_ID` if
   Adobe sends a client ID other than the OAuth app's.
6. **Allowance**: set the transactions per year and the allowance year start month in VeQMS Settings to match the
   contract.

## Verify before go-live

Against Adobe's v6 API reference and a developer account (Adobe offers a free Developer Edition):

- Transient document upload: the multipart part names (`File`, `File-Name`, `Mime-Type`).
- `POST /agreements`: `participantSetsInfo` with one set per signer and `order`; that two sets with the same `order`
  sign in parallel (reviewers); `signatureType: ESIGN`, `state: IN_PROCESS`, `externalId`.
- Text tags: the PDF carries `{{Sig1_es_:signer1:signature}}` (and so on) in white under each signature line. Check
  that Adobe places the fields there, that the signer index follows the participant order, and the field size.
- `GET /agreements/{id}/events`: the field names VeQMS reads (`type`, `date`, `participantEmail`, `comment`) and the
  event types for signed (`ESIGNED`) and rejected (`REJECTED`).
- Cancelling: `PUT /agreements/{id}/state` with `CANCELLED` (some Adobe pages show `CANCELED`) and
  `agreementCancellationInfo`.
- Downloads: `GET /agreements/{id}/combinedDocument` and `/auditTrail`.
- OAuth refresh: `POST {apiAccessPoint}oauth/v2/refresh`.
- Webhooks: the `X-AdobeSign-ClientId` echo, and that `agreement.id` and `event` are in the notification.
- That the audit report shows the identity check and the reason for signing for each signer.

## Development and UAT without Adobe Sign

`ADOBE_SIGN_MODE=mock` sends nothing. Each signer signs or declines in VeQMS when it is their turn
(`POST /agreements/:id/mock/sign` and `/mock/decline`); the API generates stand-in signed PDFs and audit reports
marked MOCK. Every other rule (order, segregation of duties, allowance, locks, completion) is the same code path as
live. The API refuses mock mode when `NODE_ENV=production`.

## KSTARRS history

Approvals made before go-live (`settings.signing_go_live`) are imported as signatures with `source = 'kstarrs'` and
the versions marked `migrated_from = 'KSTARRS'`. See [08 · Migration](08-migration.md).
