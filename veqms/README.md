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

## Try these in order (about 15 minutes)

1. **Today** → POL-004 → *Open in DocuSign* → tick the review box → *Continue* → any 6 digits → *Sign*.
   The author and both reviewers have already signed the envelope; you sign as QA approver 1 (simulated DocuSign page).
2. Account menu → **Demo · view as PJ Walters** → sign the same envelope. It completes: POL-004 v2.0 becomes
   **Effective**, v1.0 is **Superseded**, the signed PDF, certificate of completion and envelope ID are stored
   (**Approval · DocuSign** tab), the author and reviewers get completed training records from the envelope, and the
   rest of *All staff* is allocated v2.0.
3. Back as **Victoria**, open POL-003 → *Verify and send to DocuSign*. You wrote it and you're listed as QA approver,
   so sending is blocked by segregation of duties and logged. Pick PJ as QA approver, tick the four verification
   checks and send: one envelope, one send. Then try **Void envelope** with a reason: it returns to draft, and a
   corrected envelope is a second send.
4. **Approvals and DocuSign** (left rail): sends used and remaining against 500 a year, the sends log (including the
   seeded SOA-001 correction), and the register of approvals. Export either as PDF or Excel.
5. **Training** → *Start* on SOP-012 → read → knowledge check → confirm “I confirm I have read and understood
   SOP-012, version 3.0”. The app sets the date and time and locks the record. Then look at **Training matrix**,
   **Records** (pick a person or a document) and **Audiences**.
6. **Quality** → CAPA-005 → Effectiveness check → record the result → send the closure to DocuSign. Sign as
   **Carrie Foreman** (owner), then as Victoria (QA). QE-017 (a deviation) closes the same way.
7. **Quality** → CAPA-007 → Root cause (5 Whys / Fishbone), Risk assessment, Evidence (upload shows the malware-scan step).
8. **Quality** → QE-015 (a nonconformance) as **Louise Harvey** → *Close without CAPA*: an in-app signature, blocked until a justification is written.
9. Narrow the window (or use a phone): bottom tab bar → **Raise** → tick *simulate being offline* → submit → untick: it syncs.
10. **Administration → Audit trail** → *Run tamper test*: the hash-chain verifier flags the edited entry.
11. As **Lucy Parkin** (System Administrator): Users → *Simulate a new starter (SCIM)* (training is allocated at once), open a user and change their groups, revoke-now; Integrations → DocuSign card shows sends used.
12. As **Fraser Scott** (auditor): read-only, time-boxed, Restricted records hidden; can see the approvals register and training reports but can't send or correct.

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
| 4.1 My Work | Today (Overdue → Next 7 days → Upcoming), filters, Assigned/Created by me, saved views, selected-task panel; *Open in DocuSign* and *Verify and send* tasks; mobile Tasks |
| 4.2 Document Control | Register (sort, filter, CSV), create from template / blank / upload, auto-numbering, check-out/in, mandatory change summary (AI button off until a provider is approved), lifecycle stepper, viewer with state watermarks + viewer name, comments, version compare, version history, signature manifest page, classification-aware download |
| 4.3 Training | Read and understood (read → knowledge check → confirm statement), per-document audiences (groups incl. All staff, roles, people), allocation on effective with earlier records superseded, completed records for author and reviewers from the approval envelope, new starter / group / role changes allocated automatically, locked records with corrections, reminders, training matrix, individual and per-document reports (PDF and Excel) |
| 4.4 Change Control | List + board, six tabs, Major/Minor help text, actions with signature toggle, plan and completion e-signatures, plan PDF |
| 4.5 Periodic Reviews | My / Organisation reviews, "No update needed" (signed, date resets) or "Needs update" (new draft or CR) |
| 4.6 Quality events & CAPA | Observations (escalate / close with reason), events (close without CAPA = justification + signature), CAPA planning → execution → effectiveness, 5 Whys, fishbone, risk matrix, evidence scanning |
| 4.7 Analytics | Seven tabs, KPIs, charts, "Full report" drill-down + CSV, RBAC-filtered |
| 4.8 Cross-cutting | Ctrl/Cmd+K palette (records, document text, create, go to), links visible from both ends, help centre, first-run tour and per-module tips |
| 5 Workflow + e-signatures | Approvals through DocuSign (Part 11 module): one envelope per version, author → reviewers → QA approver with meanings, verification check before sending, status from Connect, declined/voided returns with reason, signed PDF + certificate + envelope ID stored, sends log against 500 a year. Other signatures in-app with fresh re-auth; SoD; insert-only signature records |
| 6 Automation | Event → condition → action rules (versioned, need approval), run history, dead-letter queue with retry, per-channel notification log, FYI vs action notifications, overdue escalation settings |
| 7 Integrations | Connector cards with least-privilege permissions, health, on/off and retry queue |
| 10 Security support | Hash-chained audit trail with verify + tamper test, classification handling, revoke-now, two-person rule for privileged roles, quarterly access review, retention and legal hold, subject-access export |

## What's simulated

- **Sign-in and step-up signing** (Entra ID, `prompt=login`, auth context `c1`), so any 6-digit code works.
- **DocuSign**: envelopes, signing, Connect status updates, signed PDFs and certificates are simulated in the browser. The signing page is a stand-in for DocuSign's; any 6 digits work.
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
js/docusign.js      approvals through DocuSign: envelopes, signing order, sends, completion
js/ui.js            router, shell, drawers, menus, command palette, shared components
js/sign.js          e-signature drawer (Confirm → Sign in again → Recorded)
js/views/*.js       one file per module (approvals.js: send, sign, envelope details, register)
```
