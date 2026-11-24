# 04 · Security and compliance

How Phase 1 answers the threats in *Step 3 · Threat Model & Control Mapping* (`../specs/`) and the controls that
matter for electronic records and signatures. Status in the tables:

- **Built**: in the code and covered by a test that has run (see [07 · Testing](07-testing-and-validation.md)).
- **Built, untested**: in the code, not yet run against the real service (needs real packages, Azure or Adobe Sign).
- **Deployment**: a setting or procedure in [05 · Deployment](05-deployment-azure.md) or [09 · Runbook](09-runbook.md).
- **Later**: not in Phase 1.

## A change from the threat model: Part 11 is now in scope

The threat model's residual risk **R8** assumed "no Part 11 records". The signatures and training sign-off brief
changed that: approvals of controlled documents, CAPA closures and deviation closures are now signed in Adobe Sign with
the Bio-Pharma settings (Part 11 support). As R8 says, formal validation is then extra work that Step 1 did not cost. That work is set out
in [07 · Testing and validation](07-testing-and-validation.md). Read-and-understood training confirmations stay in
the app and are not treated as Part 11 signatures (the brief's decision).

VeQMS signs nothing itself: every signature, including later phases' periodic reviews and change request and CAPA
actions marked `needs_signature`, goes through Adobe Sign, whose Bio-Pharma settings check the signer's identity at
the moment of signing. So no Entra authentication context (step-up sign-in) is set up for signing in VeQMS. The
database refuses any signature that didn't come from Adobe Sign (or KSTARRS, for migrated approvals).

## Threats and controls

| Threat (Step 3) | Control in Phase 1 | Status |
|---|---|---|
| T01 Phishing steals a password or session | Microsoft Entra ID sign-in; MFA and conditional access are Entra policy | Deployment |
| T02 Stolen session used to sign | Every signature happens in Adobe Sign, whose Bio-Pharma settings check the signer's identity at the moment of signing. VeQMS never signs for anyone in live mode, and the database accepts no signature from anywhere else | Built, untested (Adobe Sign account settings) |
| T03 Token from another app or tenant accepted | API checks issuer (your tenant), audience (the API registration) and the `access_as_user` scope on every request | Built, untested (needs Entra) |
| T04 Signature row edited | `signatures` is insert-only; the API role has no update or delete | Built |
| T05 Signer denies approving | Adobe Sign audit report and signed PDF stored with SHA-256 hashes; agreement ID and every status event kept | Built (mock); live untested |
| T06 Approved file swapped in storage | Files written once (`wx` locally; blob container with a retention policy in Azure); hashes in the database | Built locally; Azure policy is Deployment |
| T07 DBA edits or deletes audit rows | Append-only `audit_log`, hash chain, `app.verify_audit_chain()`, daily and on-demand checks | Built |
| T08 Super-admin re-hashes the chain | The `veqms-anchor` job writes the chain head to the immutable `records` container every 15 minutes (default, as Step 1 proposes); `GET /audit/verify` compares the latest anchor with the chain, so a rewrite shows as a mismatch. A change made after the last anchor is caught only by the chain check | Built, untested in Azure; interval open decision R4 |
| T-privacy IP address and device in the audit trail | Kept apart from the chain in `audit_client_info`, linked by ID, and deleted after `settings.client_info_retention_days` (default 90, to confirm); the chain covers only the link, so it still verifies | Built |
| T09 Audit entries lost on error | The audit entry is in the same transaction as the change: both happen or neither does. Refusals are logged in their own transaction | Built |
| T10 Reading or editing outside your rights | Permission check on every route; classification check on documents, agreement views and downloads; row-level security per tenant | Built |
| T11 Author approves own record | Signing plan refuses author or reviewer as QA approver, and owner as closure approver; the refusal is logged | Built |
| T12 Administrator gives themselves approval | Nobody can change their own roles; admin can't hold Approver or Quality Manager | Built. Two-person rule for role grants is open decision R3 |
| T13 Pooled connection carries another request's tenant | Tenant and user are set with transaction-local settings, cleared at commit or rollback | Built |
| T14 Restricted document downloaded without clearance | Clearance or named involvement required for document detail, PDF, agreement files; denial logged | Built |
| T15, T16 Malicious uploads, converter exploits | Phase 1 has no file uploads or Office conversion: documents are written in the app and rendered by the API | Later |
| T17 Stored XSS | React escapes all output; no raw HTML anywhere in the web app | Built, untested in a browser |
| T18 Cross-site request forgery | Session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` in production; changes go through Next.js Server Actions | Built, untested |
| T19 Flooding | Body size limit; Azure front-end limits | Deployment. Rate limiting is Later |
| T20 Automation or notifications fail silently | Each automation run is logged (`automation_runs`); email attempts are logged (`notification_log`); job exits non-zero on failure | Built |
| T22 Restricted content in email | Emails carry a record title, a short note (for example a decline reason) and a link, never document content. Check whether titles of Restricted documents may go by email | Built; decision needed |
| T23 Look-alike "Approve" email | Approval emails come from Adobe Sign, not VeQMS; VeQMS emails never carry an approve button | Built |
| T24 Leaver's live session | API checks status on every request; revoking access ends sessions at once; SCIM deactivation does the same | Built |
| T25 Forged SCIM call | Bearer secret compared in constant time; new users get Employee only | Built |
| T26 Mail credential sends as anyone | Graph `Mail.Send` must be limited to the one mailbox with an Exchange application access policy | Deployment |
| T27 Secrets in code or logs | Secrets only in Key Vault; logs redact authorization headers and cookies | Built, Deployment |
| T28, T29 Malicious code or pipeline | CI type-checks and tests every push; deploys use GitHub OIDC, no stored Azure keys | Deployment |
| T30 Ransomware or deletion of backups | Azure backups (geo-redundant), point-in-time restore drill | Deployment |
| T34 Forged Adobe Sign webhook | Adobe Sign doesn't sign notifications, so the API accepts them only on a secret URL (`ADOBE_SIGN_WEBHOOK_TOKEN`) with the expected client ID, and then reads the agreement from Adobe Sign and acts only on that. A forged notification can at most trigger a status check | Built (checks, sync logic); live untested |
| T31, T32, T33, T35, T36 | Logs, support access, mobile, SharePoint, Teams | Later or Deployment |

## Electronic records and signatures (21 CFR Part 11)

This is our reading of how the build supports Part 11 for the Route 1 approvals. It is a planning aid, not a
compliance opinion: confirm it with your validation lead against the regulation text and FDA guidance, and refer
legal interpretation to **PJ Walters**. Section numbers are from 21 CFR Part 11; check them against the current text.

| Requirement | Where it is met |
|---|---|
| §11.10(a) Validation | Not met by code alone. Needs the validation plan, IQ/OQ/PQ and traceability in [07](07-testing-and-validation.md) |
| §11.10(b) Accurate and complete copies | Signed PDF and audit report downloadable from each agreement; Excel and PDF report exports stamped with time and user |
| §11.10(c) Protection of records | Insert-only tables, locked agreements and training records, immutable blob container, backups |
| §11.10(d) Limiting access | Entra ID sign-in, roles, classification, row-level security |
| §11.10(e) Audit trail | Computer-generated, time-stamped, append-only, hash-chained; old and new values on changes; kept with the records |
| §11.10(f) Operational checks | Workflow states enforced in the API and database (review before approval, signing order, one open agreement) |
| §11.10(g) Authority checks | Permission checks on every route; approver must hold Approver or Quality Manager |
| §11.10(h) Device checks | Not applicable to this design as far as we can see; confirm with the validation lead |
| §11.10(i) Training of people | Read-and-understood records in the app (Route 2) |
| §11.10(j), (k) Policies and documentation control | Written procedures (SOPs) held in VeQMS itself; this documentation set under change control |
| §11.50 Signature manifestation | Adobe Sign signature with name, date and time; the meaning (Authored, Reviewed, Approved) is printed on the signature page and recorded in `signatures.meaning` |
| §11.70 Signature and record linking | Each signature row holds the agreement ID and the SHA-256 of the exact PDF signed; the signed PDF is stored with its own hash |
| §11.100, §11.200, §11.300 Signature components and identity | Provided by Adobe Sign's Bio-Pharma settings (identity check at signing, required reason for signing) and Entra ID for the VeQMS account. Confirm the Adobe Sign account settings during validation |

## Open decisions from the threat model

Still needed before go-live (from Step 3, page 16): R1 independent reviewer for security-sensitive changes; R2 who
holds System Administrator in production and who signs UAT; R3 two-person rule for role grants; R4 audit anchor
interval; R5 and R6 leaver and availability targets; R7 support access from the Philippines; R8 now answered above;
penetration test supplier and budget.
