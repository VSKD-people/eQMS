# VeQMS — frontend prototype

A working, clickable frontend for the eQMS described in the build prompt (Rev 2.2) and the Step 1–3 documents.
There is **no backend or database**: sample records are created in the browser and every change is saved in that
browser's local storage until you choose **Reset demo data** (account menu).

## Run it

Serve the folder and open http://localhost:4173 (this is how it was tested):

```bash
python3 -m http.server 4173 --directory veqms
```

Opening `index.html` directly should also work, because it uses plain scripts with no fetch calls, but that route wasn't tested.

No build step and no npm packages. Fonts load from Google Fonts when online; the app falls back to system fonts offline.

## Try these in order (about 25 minutes)

Documents follow the amendment flow decided on 24 November 2026. Every amendment starts as a change request. The
author edits the Word file in the SharePoint Drafts library (here, a stand-in editor), then submits in two steps:
make the PDF (converted, hashed and locked) and check it. Reviewers mark it reviewed, QA approvers approve it in VeQMS
and decide whether people need retraining, and the last approval sends one Adobe Sign agreement with every signer:
Draft → In review → In approval → Signing → Effective. Every signature except read-and-understood training is made
in **Adobe Sign** (Adobe Acrobat Sign, with the account's Bio-Pharma settings for Part 11). Adobe Sign and SharePoint
are simulated here.

1. **Today** → POL-004 → *Open in Adobe Sign* → tick the review box → *Continue* → any 6 digits → *Sign*.
   Both QA approvers have approved POL-004 v2.0 in VeQMS; PJ's approval, the last, sent the agreement at once. The
   author and both reviewers have signed it; you sign as QA approver 1 (simulated Adobe Sign page).
2. Account menu → **Demo · view as PJ Walters** → sign the same agreement. It completes: POL-004 v2.0 becomes
   **Effective**, v1.0 is **Superseded**, the signed PDF, audit report and agreement ID are stored
   (**Approval · Adobe Sign** tab), the author and reviewers get completed training records from the agreement, and
   the rest of *All staff* is allocated v2.0 (the approvers decided it needs retraining). The change request opened
   with v2.0 (CR-017) closes, and v2.0 is published to the controlled SharePoint library.
3. Still as **PJ Walters**: **Today** → CR-016 → sign the change request plan in Adobe Sign. Victoria has already
   signed as process owner; when you sign, the plan is approved and the action owners get their tasks.
4. Still as **PJ Walters**: **Today** → POL-003 → *Approve*. It's a correction, so choose **No** for retraining and
   say why (a reason is required). You're the only QA approver, so the agreement goes to Adobe Sign at once and
   POL-003 is **Signing**: one agreement, one transaction, no send button. (*Return to the author* is there too.) Sign
   it as **Victoria** (author), **Carrie Foreman** (reviewer) and **PJ** in turn: v1.1 is Effective, training on v1.0
   still counts, and nobody is newly allocated (**Training** tab).
5. As **Jim Speir**: open WI-003 → *Open in Word* (the stand-in for the Word file in SharePoint) → change a line and
   the change summary → *Save the Word file*. Then *Submit for review*. Step 1: tick PJ as a reviewer and choose PJ as
   QA approver → *Make the PDF*: refused by segregation of duties, and logged. Untick PJ as a reviewer → *Make the
   PDF*. Step 2: *Open the PDF to check it*, tick the four checks (footer, version, document ID, dates) → *Submit for
   review*. Carrie and Omar get review tasks; any of them can *Return to the author* with a reason. Editing the Word
   file again clears the locked PDF.
6. **Approvals** (left rail): transactions used and remaining against 500 a year, the transactions log (including
   the seeded SOA-001 correction) and the register of approvals. Export either as PDF or Excel.
7. As **Victoria**: **Training** → *Start* on SOP-012 → read → knowledge check → the confirm step says *Open the PDF
   of v3.0 first*. Open it (VeQMS logs the open with the version), then confirm “I confirm I have read and understood
   SOP-012, version 3.0”. This is not a signature: the app sets the date and time and locks the record. Then look at
   **Training matrix**, **Records** (pick a person or a document) and **Audiences**.
8. **Quality** → CAPA-005 → Effectiveness check → record the result → send the closure to Adobe Sign. Sign as
   **Carrie Foreman** (owner), then as Victoria (QA). QE-017 (a deviation) and QE-015 (a nonconformance) close
   without a CAPA the same way: write the justification, then owner and QA approver sign.
9. Only actions marked *needs a signature* go to Adobe Sign. As **Jim Speir**: **Change requests** → CR-012 → Actions
   → *Complete and send to Adobe Sign* on A-4, then sign it. As **Victoria**: **Quality** → CAPA-007 → Actions →
   *Mark done* on CA-2: it needs no signature, so it is done in the app with no agreement and no transaction. When you
   add an action, you choose whether it needs a signature.
10. As **Omar Haddad**: **Quality** → CAPA-008 → *Send action plan to Adobe Sign* (high severity: Omar, then a
    Quality Manager). The actions lock when the agreement completes.
11. As **Victoria**: **Administration → SharePoint**: the last sync of the Drafts and Controlled libraries, each
    Effective version's published file (superseded ones stay, marked Superseded), and an open integrity alert on
    FRM-007. Under *Simulate an outside edit*, pick SOP-012 → *Simulate the outside edit* → *Sync now*: a new alert
    (changed outside VeQMS), and every Quality Manager is told. *Check hashes now* adds a hash mismatch. *Resolve*
    needs a note of what was found and done, can publish the locked PDF again, and is final.
12. **Quality** → CAPA-007 → Root cause (5 Whys / Fishbone), Risk assessment, Evidence (upload shows the malware-scan step).
13. Narrow the window (or use a phone): bottom tab bar → **Raise** → tick *simulate being offline* → submit → untick: it syncs.
14. **Administration → Audit trail** → *Run tamper test*: the hash-chain verifier flags the edited entry.
15. As **Lucy Parkin** (System Administrator): Users → *Simulate a new starter (SCIM)* (training is allocated at once), open a user and change their groups, revoke-now; Access review → *Sign off this quarter* (in Adobe Sign); Integrations → Adobe Sign card shows transactions used; SharePoint → she can sync but not resolve alerts.
16. As **Fraser Scott** (auditor): read-only, time-boxed, Restricted records hidden; can see the approvals register, training reports and the SharePoint tab but can't send, correct or resolve.

## Personas

| Persona | Roles | Clearance |
|---|---|---|
| Victoria E. | HR Administrator, Quality Manager, Approver, Process Owner, Support Owner | Restricted |
| Jim Speir | Author, Reviewer | Confidential |
| Carrie Foreman | Reviewer, Author | Restricted |
| PJ Walters | Approver, Process Owner | Restricted |
| Louise Harvey | Process Owner, Reviewer | Confidential |
| Daniel Greenwood | Employee / Trainee | Internal |
| Lucy Parkin | System Administrator (cannot approve) | Confidential |
| Fraser Scott | Auditor (read-only, time-boxed) | Confidential |
| Omar Haddad | Reviewer, Author | Confidential |

## What's in it

| Spec section | Where |
|---|---|
| 4.1 My Work | Today (Overdue → Next 7 days → Upcoming), filters, Assigned/Created by me, saved views, selected-task panel; *Approve*, *Open in Adobe Sign* and *Verify and send* tasks; mobile Tasks |
| 4.2 Document Control | Register (sort, filter, CSV), create from template / blank / upload, auto-numbering (incl. user access reviews UAR and risk assessments RA), a change request opened with every new document or version, the Word file in the SharePoint Drafts library (*Open in Word*: a stand-in editor), mandatory change summary (AI button off until a provider is approved), submit in two steps (make the locked PDF, then the four checks on it), review, approval in VeQMS with the retraining decision, return to the author, automatic send on the last approval, lifecycle stepper (Draft → In review → In approval → Signing → Effective), viewer with state watermarks + viewer name, comments, version compare, version history, signature manifest page, classification-aware download |
| 4.3 Training | Read and understood (open the PDF of the version → knowledge check → confirm statement; confirming is refused until the logged open), per-document audiences (groups incl. All staff, roles, people), allocation on effective with earlier records superseded unless the QA approvers decided no retraining is needed, completed records for author and reviewers from the approval agreement, new starter / group / role changes allocated automatically, locked records with corrections, reminders, training matrix, individual and per-document reports (PDF and Excel) |
| 4.4 Change Control | List + board, six tabs, Major/Minor help text; minimal change requests opened with each document version (they close when it is Effective); plan and completion approved in Adobe Sign (process owner, then approvers); only actions marked *needs a signature* go to Adobe Sign, the rest are done in the app; plan PDF |
| 4.5 Periodic Reviews | My / Organisation reviews, "No update needed" (signed in Adobe Sign, date resets) or "Needs update" (new draft or CR) |
| 4.6 Quality events & CAPA | Observations (escalate / close with reason), events (close without CAPA = justification, then owner and QA approver sign in Adobe Sign), CAPA plan, action sign-offs, completed actions and closure in Adobe Sign, 5 Whys, fishbone, risk matrix, evidence scanning |
| 4.7 Analytics | Seven tabs, KPIs, charts, "Full report" drill-down + CSV, RBAC-filtered |
| 4.8 Cross-cutting | Ctrl/Cmd+K palette (records, document text, create, go to), links visible from both ends, help centre, first-run tour and per-module tips |
| 5 Workflow + e-signatures | Every signature except read-and-understood training through Adobe Sign: one agreement per sign-off, signers in order with reasons for signing (Authored, Reviewed, Approved, Completed), verification check before sending (for documents, made on the locked PDF at submit; the agreement goes when the last QA approver approves), status from webhooks read back from the API, declined/cancelled returns with reason, signed PDF + audit report + agreement ID stored, transactions log against 500 a year. Segregation of duties checked in every signing plan; insert-only signature records |
| 6 Automation | Event → condition → action rules (versioned, need approval), run history, dead-letter queue with retry, per-channel notification log, FYI vs action notifications, overdue escalation settings |
| 7 Integrations | Connector cards with least-privilege permissions, health, on/off and retry queue; Administration → SharePoint: last sync of the Drafts and Controlled libraries, publishing of Effective versions, integrity alerts (changed outside VeQMS, file missing, hash mismatch, publish failed) resolved by a Quality Manager, *Sync now*, a hash check and a simulated outside edit |
| 10 Security support | Hash-chained audit trail with verify + tamper test, classification handling, revoke-now, two-person rule for privileged roles, quarterly access review, retention and legal hold, subject-access export |

## What's simulated

- **Sign-in** (Microsoft Entra ID).
- **Adobe Sign**: agreements, signing (identity check and reason for signing), webhook status updates, signed PDFs and audit reports are simulated in the browser. The signing page is a stand-in for Adobe Sign's; any 6 digits work.
- **SharePoint**: the Word file of each document (a name and last-edited time; the stand-in editor plays Word),
  the conversion to PDF, publishing to the controlled library, the delta sync, integrity alerts and the hash check all
  happen in the browser. *Simulate an outside edit* stands in for someone changing a published file.
- **Microsoft 365 and Teams**: switches and logs only; nothing is sent.
- **Malware scanning and Office-to-PDF conversion**: a short delay, then "Scanned clean".
- **PDFs**: open as a printable page (use Print → Save as PDF); the server renders them in production.
- Analytics trends include a little sample history so charts aren't empty.
- Every permission check here is mirrored from the design; in production the API enforces them.

## Files

```
index.html          app shell
css/app.css         design tokens (Step 2), components, light/dark, responsive
js/core.js          safe HTML templating, dates, SHA-256, icons, CSV
js/seed.js          sample data (dates relative to today)
js/store.js         persistence, RBAC + classification, audit chain, notifications, tasks
js/engine.js        workflow engine, automation rules, signatures, SoD, training allocation and records
js/esign.js         signatures through Adobe Sign: a stage per sign-off, signing plans, transactions, completion
js/sharepoint.js    SharePoint (simulated): publishing, delta sync, integrity alerts, hash check
js/ui.js            router, shell, drawers, menus, command palette, shared components
js/views/*.js       one file per module (approvals.js: send, sign, agreement details, register)
```
