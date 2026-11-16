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

## Try these in order (about 10 minutes)

1. **Today** → POL-004 → *Review and sign* → *Continue to sign-in* → *Sign in again* → any 6 digits.
   You get a signature with UTC time, `auth_time` and the SHA-256 of v2.0.
2. Account menu → **Demo · view as Tom Hughes** → it's now his turn (sequential route). Sign → POL-004 becomes
   **Effective**, v1.0 is **Superseded**, training is assigned to *All staff*, and a periodic review is scheduled.
3. Back as **Victoria**, open POL-003 (you wrote it, and you're also listed as an approver): signing is blocked by
   segregation of duties and the attempt is logged. Tom can still approve it.
4. **Training** → *Start* on SOP-012 → read → knowledge check → sign.
5. **Quality** → CAPA-007 → Root cause (5 Whys / Fishbone), Risk assessment, Evidence (upload shows the malware-scan step).
6. **Quality** → QE-015 as **Grace Lim** → *Close without CAPA*: blocked until a justification is written and signed.
7. Narrow the window (or use a phone): bottom tab bar → **Raise** → tick *simulate being offline* → submit → untick: it syncs.
8. **Administration → Audit trail** → *Run tamper test*: the hash-chain verifier flags the edited entry.
9. As **Hannah Weber** (System Administrator): Users → revoke-now; Integrations → switch connectors on/off; Automations → retry the dead-letter queue.
10. As **Alex Morgan** (auditor): read-only, time-boxed, Restricted records hidden.

## Personas

| Persona | Roles | Clearance |
|---|---|---|
| Victoria E. | Quality Manager (stand-in), Approver, Process Owner, Support Owner | Restricted |
| Sam Okafor | Author, Reviewer | Confidential |
| Priya Raman | Reviewer, Author | Restricted |
| Tom Hughes | Approver, Process Owner | Restricted |
| Grace Lim | Process Owner, Reviewer | Confidential |
| Daniel Cruz | Employee / Trainee | Internal |
| Hannah Weber | System Administrator (cannot approve) | Confidential |
| Alex Morgan | Auditor (read-only, time-boxed) | Confidential |

## What's in it

| Spec section | Where |
|---|---|
| 4.1 My Work | Today (Overdue → Next 7 days → Upcoming), filters, Assigned/Created by me, saved views, selected-task panel, batch "Sign all"; mobile Tasks |
| 4.2 Document Control | Register (sort, filter, CSV), create from template / blank / upload, auto-numbering, check-out/in, mandatory change summary (AI button off until a provider is approved), lifecycle stepper, viewer with state watermarks + viewer name, comments, version compare, version history, signature manifest page, classification-aware download |
| 4.3 Training | My training (read → quiz → sign), Organisation view (KPIs, records, CSV/PDF), versioned rules that need approval, Pending-training gate, leavers' records kept |
| 4.4 Change Control | List + board, six tabs, Major/Minor help text, actions with signature toggle, plan and completion e-signatures, plan PDF |
| 4.5 Periodic Reviews | My / Organisation reviews, "No update needed" (signed, date resets) or "Needs update" (new draft or CR) |
| 4.6 Quality events & CAPA | Observations (escalate / close with reason), events (close without CAPA = justification + signature), CAPA planning → execution → effectiveness, 5 Whys, fishbone, risk matrix, evidence scanning |
| 4.7 Analytics | Seven tabs, KPIs, charts, "Full report" drill-down + CSV, RBAC-filtered |
| 4.8 Cross-cutting | Ctrl/Cmd+K palette (records, document text, create, go to), links visible from both ends, help centre, first-run tour and per-module tips |
| 5 Workflow + e-signatures | Shared engine, sequential/parallel routing, SoD, fresh re-auth per signature, insert-only signature records |
| 6 Automation | Event → condition → action rules (versioned, need approval), run history, dead-letter queue with retry, per-channel notification log, FYI vs action notifications, overdue escalation settings |
| 7 Integrations | Connector cards with least-privilege permissions, health, on/off and retry queue |
| 10 Security support | Hash-chained audit trail with verify + tamper test, classification handling, revoke-now, two-person rule for privileged roles, quarterly access review, retention and legal hold, subject-access export |

## What's simulated

- **Sign-in and step-up signing** (Entra ID, `prompt=login`, auth context `c1`), so any 6-digit code works.
- **Microsoft 365, Teams, SharePoint, DocuSign**: switches and logs only; nothing is sent.
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
js/engine.js        workflow engine, automation rules, signatures, SoD
js/ui.js            router, shell, drawers, menus, command palette, shared components
js/sign.js          e-signature drawer (Confirm → Sign in again → Recorded)
js/views/*.js       one file per module
```

Placeholder brand: swap `--accent*` and the two font stacks in `css/app.css` when the Katalyze Data colours, logo and fonts arrive.
