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

## Try these in order (about 20 minutes)

Every signature except read-and-understood training is made in **Adobe Sign** (Adobe Acrobat Sign, with the
account's Bio-Pharma settings for Part 11): one agreement per sign-off, with every signer in order. Adobe Sign is
simulated here.

1. **Today** → POL-004 → *Open in Adobe Sign* → tick the review box → *Continue* → any 6 digits → *Sign*.
   The author and both reviewers have already signed the agreement; you sign as QA approver 1 (simulated Adobe Sign page).
2. Account menu → **Demo · view as PJ Walters** → sign the same agreement. It completes: POL-004 v2.0 becomes
   **Effective**, v1.0 is **Superseded**, the signed PDF, audit report and agreement ID are stored
   (**Approval · Adobe Sign** tab), the author and reviewers get completed training records from the agreement, and
   the rest of *All staff* is allocated v2.0.
3. Still as **PJ Walters**: **Today** → CR-016 → sign the change request plan in Adobe Sign. Victoria has already
   signed as process owner; when you sign, the plan is approved and the action owners get their tasks.
4. Back as **Victoria**, open POL-003 → *Verify and send to Adobe Sign*. You wrote it and you're listed as QA
   approver, so sending is blocked by segregation of duties and logged. Pick PJ as QA approver, tick the four
   verification checks and send: one agreement, one transaction. Then try **Cancel agreement** with a reason: it
   returns to draft, and a corrected agreement is a second transaction.
5. **Approvals** (left rail): transactions used and remaining against 500 a year, the transactions log (including
   the seeded SOA-001 correction) and the register of approvals. Export either as PDF or Excel.
6. **Training** → *Start* on SOP-012 → read → knowledge check → confirm “I confirm I have read and understood
   SOP-012, version 3.0”. This is not a signature: the app sets the date and time and locks the record. Then look at
   **Training matrix**, **Records** (pick a person or a document) and **Audiences**.
7. **Quality** → CAPA-005 → Effectiveness check → record the result → send the closure to Adobe Sign. Sign as
   **Carrie Foreman** (owner), then as Victoria (QA). QE-017 (a deviation) and QE-015 (a nonconformance) close
   without a CAPA the same way: write the justification, then owner and QA approver sign.
8. As **Jim Speir**: **Change requests** → CR-012 → Actions → *Complete and send to Adobe Sign* on A-4, then sign it.
   Actions that need a signature are signed off by the person who did them; the action is done when they sign.
9. As **Omar Haddad**: **Quality** → CAPA-008 → *Send action plan to Adobe Sign* (high severity: Omar, then a
   Quality Manager). The actions lock when the agreement completes.
10. **Quality** → CAPA-007 → Root cause (5 Whys / Fishbone), Risk assessment, Evidence (upload shows the malware-scan step).
11. Narrow the window (or use a phone): bottom tab bar → **Raise** → tick *simulate being offline* → submit → untick: it syncs.
12. **Administration → Audit trail** → *Run tamper test*: the hash-chain verifier flags the edited entry.
13. As **Lucy Parkin** (System Administrator): Users → *Simulate a new starter (SCIM)* (training is allocated at once), open a user and change their groups, revoke-now; Access review → *Sign off this quarter* (in Adobe Sign); Integrations → Adobe Sign card shows transactions used.
14. As **Fraser Scott** (auditor): read-only, time-boxed, Restricted records hidden; can see the approvals register and training reports but can't send or correct.

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

## What's in it

| Spec section | Where |
|---|---|
| 4.1 My Work | Today (Overdue → Next 7 days → Upcoming), filters, Assigned/Created by me, saved views, selected-task panel; *Open in Adobe Sign* and *Verify and send* tasks; mobile Tasks |
| 4.2 Document Control | Register (sort, filter, CSV), create from template / blank / upload, auto-numbering, check-out/in, mandatory change summary (AI button off until a provider is approved), lifecycle stepper, viewer with state watermarks + viewer name, comments, version compare, version history, signature manifest page, classification-aware download |
| 4.3 Training | Read and understood (read → knowledge check → confirm statement), per-document audiences (groups incl. All staff, roles, people), allocation on effective with earlier records superseded, completed records for author and reviewers from the approval agreement, new starter / group / role changes allocated automatically, locked records with corrections, reminders, training matrix, individual and per-document reports (PDF and Excel) |
| 4.4 Change Control | List + board, six tabs, Major/Minor help text, actions signed off in Adobe Sign, plan and completion approved in Adobe Sign (process owner, then approvers), plan PDF |
| 4.5 Periodic Reviews | My / Organisation reviews, "No update needed" (signed in Adobe Sign, date resets) or "Needs update" (new draft or CR) |
| 4.6 Quality events & CAPA | Observations (escalate / close with reason), events (close without CAPA = justification, then owner and QA approver sign in Adobe Sign), CAPA plan, action sign-offs, completed actions and closure in Adobe Sign, 5 Whys, fishbone, risk matrix, evidence scanning |
| 4.7 Analytics | Seven tabs, KPIs, charts, "Full report" drill-down + CSV, RBAC-filtered |
| 4.8 Cross-cutting | Ctrl/Cmd+K palette (records, document text, create, go to), links visible from both ends, help centre, first-run tour and per-module tips |
| 5 Workflow + e-signatures | Every signature except read-and-understood training through Adobe Sign: one agreement per sign-off, signers in order with reasons for signing (Authored, Reviewed, Approved, Completed), verification check before sending, status from webhooks read back from the API, declined/cancelled returns with reason, signed PDF + audit report + agreement ID stored, transactions log against 500 a year. Segregation of duties checked in every signing plan; insert-only signature records |
| 6 Automation | Event → condition → action rules (versioned, need approval), run history, dead-letter queue with retry, per-channel notification log, FYI vs action notifications, overdue escalation settings |
| 7 Integrations | Connector cards with least-privilege permissions, health, on/off and retry queue |
| 10 Security support | Hash-chained audit trail with verify + tamper test, classification handling, revoke-now, two-person rule for privileged roles, quarterly access review, retention and legal hold, subject-access export |

## What's simulated

- **Sign-in** (Microsoft Entra ID).
- **Adobe Sign**: agreements, signing (identity check and reason for signing), webhook status updates, signed PDFs and audit reports are simulated in the browser. The signing page is a stand-in for Adobe Sign's; any 6 digits work.
- **Microsoft 365, Teams, SharePoint**: switches and logs only; nothing is sent.
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
js/ui.js            router, shell, drawers, menus, command palette, shared components
js/views/*.js       one file per module (approvals.js: send, sign, agreement details, register)
```
