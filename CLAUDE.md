# VeQMS prototype — notes for Claude

Read this first. It is the hand-over from the Claude session that built this prototype.

## What this is

A complete, clickable **frontend-only** prototype of the eQMS (electronic Quality Management System)
described in `specs/`. There is no backend and no database: sample data is generated in the browser
and every change is saved to `localStorage` until the user clicks **Reset demo data** in the account menu.

It is the clickable reference for the real build, not the start of the production codebase.
The production stack in `specs/` is TypeScript + Next.js (web), React Native/Expo (mobile),
a typed Node API and PostgreSQL with row-level security.

## Source of truth

All in `specs/`; plain-text copies of the PDFs and spreadsheets are in `specs/text/`.

| File | What it decides |
|---|---|
| `QMS_Build_Prompt.md` | Scope, modules (§4), workflow and e-signatures (§5), automation (§6), integrations (§7), security (§10) |
| `eQMS — Step 1 Architecture & Delivery Plan.pdf` | Architecture, data model, workflow engine, signature rules, phases |
| `eQMS — Step 2 Design System & Key Screens.pdf` | Colours, type, components, and the key screens. The UI follows this |
| `eQMS — Step 3 Threat Model & Control Mapping.pdf` | Threats and the controls the UI has to show |
| `eQMS — Open Questions (CONFIRM items).xlsx` | The 41 open questions and the answers already confirmed |
| `eQMS — Spec Documents Index.xlsx` | Index of the documents above |

When the specs and this prototype disagree, the specs win. Ask the user before changing a confirmed answer.

## Run it

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory veqms
```

Then open http://localhost:4173. In the Claude desktop app, `.claude/launch.json` already has this as the
`veqms` preview. There is no build step and no npm install. Node isn't needed.

## Why it's plain JavaScript

The Mac it was built on had no Node.js, so it's a static single-page app: vanilla JS classic scripts,
one CSS file, and a hash router. Keep it that way unless the user asks to port it. A Next.js port is the
natural next step once Node is available.

## How the code fits together

Scripts load in this order (see `veqms/index.html`); everything hangs off one global, `window.Q`:

| File | Role |
|---|---|
| `js/core.js` | `Q.h` safe HTML templating, date helpers, `Q.sha256`, `Q.canon`, CSV, icons |
| `js/seed.js` | `Q.seed()`: all sample data. Dates are relative to today |
| `js/store.js` | Load/save, users and roles, `Q.can` permissions, classification (`Q.canSee`, `Q.canDownload`), hash-chained `Q.audit`, notifications, tasks |
| `js/engine.js` | Workflow engine `Q.wf.*` (doc, cr, obs, qe, capa, review, user), automation rules `Q.fire`, signatures, segregation of duties `Q.sodBlock`. Documents: `saveDraft`, `makePdf`, `submit`, `review`, `approve`, `sendBack`, `signing`, `returnedFromSigning`, `makeEffective`; change requests opened with each version (`Q.wf.cr.openForVersion`, `closeForVersion`). Training: audiences, allocation, `Q.trainVersions` (versions whose training counts), `Q.logPdfOpen` / `Q.pdfOpenedAt`, `Q.completeTraining`, `Q.correctTraining`, `Q.trStatus` |
| `js/esign.js` | Signatures through Adobe Sign `Q.esign.*`: `STAGES` (one per kind of sign-off: who signs, PDF lines, what completing or returning does), `plan` (signers, order, problems), `cantSend`, `send` (verification check, one agreement = one transaction), `sign`, `decline`, `cancel`, completion (signed PDF, audit report, agreement ID), allowance `used`/`remaining` |
| `js/sharepoint.js` | SharePoint, simulated `Q.sp.*`: publishing Effective versions to the controlled library (`publish`, `publishPending`, `restore`), `sync` (delta sync of the Drafts and Controlled libraries), `hashCheck`, integrity alerts (`raise`, `resolve`), `simulateOutsideEdit` for demonstrations |
| `js/ui.js` | Router, shell, drawers, menus, Ctrl/Cmd+K palette, shared components, tour |
| `js/views/*.js` | One file per module: today, documents (submit in two steps, approve with the retraining choice, return to the author, the Word stand-in editor), training, changes, reviews, quality, analytics, admin (incl. the SharePoint tab), misc, approvals (send drawer, simulated Adobe Sign signing page, agreement details, register, agreement card on records) |
| `js/app.js` | Route table and boot. Loads last |

## Rules to keep

- **Escaping.** Build markup only with the `Q.h` tagged template; it escapes every interpolated value.
  Use `Q.raw(...)` only for markup you built yourself. Never put user text into `innerHTML` any other way.
- **Events.** No inline handlers. `data-act="name"` calls `Q.act[name](el, event)`. `data-change` and
  `data-input` call `Q.on[name]`. Drawer forms submit through `data-submit`.
- **State changes go through the engine.** Views call `Q.wf.*`; they never edit records directly. The engine
  writes the audit entry (`Q.audit`, hash-chained) and fires automation (`Q.fire`).
- **Every signature goes through Adobe Sign.** Every sign-off except read-and-understood training is an Adobe Sign
  agreement: document approvals (incl. vendor approvals and validation plans and reports) and making a document
  obsolete; change request plans, action sign-offs and completion; CAPA plans, action sign-offs, completed actions
  and closures; quality event closures without a CAPA (any type); periodic reviews; the access review; rule and
  workflow approvals. Call `Q.esign.openSend(id, stage, ref)` / `Q.esign.send`, never change those records' state
  by hand; the agreement completing does it (each stage's `onComplete`), and declining or cancelling returns it
  (`onReturn`). A new kind of sign-off is a new entry in `Q.esign.STAGES`. Signing plans check approvers with
  `Q.sodBlock(record, kind, userId)`. There is no in-app e-signature drawer. Signatures are insert-only.
  Documents have no manual send: `Q.wf.doc.approve` sends the `doc-approval` agreement itself when the last QA
  approver approves (`Q.esign.send(..., { auto: true })`, with the checks made on the locked PDF at submit). Change
  request and CAPA actions go to Adobe Sign only when `needsSignature` is set; the rest are done in the app.
- **Training records are locked once completed.** Only the trainee confirms (`Q.completeTraining`); dates come from
  the system; corrections are new records (`Q.correctTraining`). Change audiences with `Q.setAudience` so the change
  is logged with old and new values.
- **Permissions.** Gate actions with `Q.can(perm)` (roles map in `store.js`), and records with `Q.canSee` and
  `Q.canDownload`. The System Administrator can't approve; the auditor is read-only.
- **Sample data version.** After changing the shape of the data in `seed.js`, bump `version` in `seed.js` and
  the matching check in `Q.load` in `store.js` (both are `12`). Old browsers then reseed instead of breaking.
- **New script files** need a `<script>` tag in `index.html`, before `js/app.js`.
- **Design tokens** live at the top of `css/app.css` (light, dark, and `[data-theme]`). The Katalyze Data brand
  is applied: pink `#E2186F` fills (`--accent-fill`), purple `#940080` text accents (`--accent`), navy `#002B49` ink,
  Montserrat, and the logo in `img/` (primary on light, reversed on dark, via `--logo`). Neutral greys, tints and the
  overdue/due status colours are functional UI colours outside the brand palette and await brand sign-off.

## Check your work

1. Syntax: open the page and check the browser console for errors.
2. Smoke test: paste `tools/smoke-test.js` into the browser console (or run it with a browser tool).
   It renders every page, tab and record as every active persona, opens the document-flow, training and
   integrity-alert drawers wherever that persona may use them, then checks the audit chain.
   The last run on this build (fresh data): 13 personas, 4,433 renders, 23 drawers, 0 errors, chain valid (319 entries).
3. End-to-end test (needs Node and Playwright): `node tools/e2e-test.js` with the app served on port 4173.
   It drives the document amendment flow (return from approval, editing clears the PDF, segregation of duties refused
   at "Make the PDF", the four checks, submit, review, approval with and without retraining, automatic send, decline,
   cancel, signing in order, Effective, change request closed, publishing), the other Adobe Sign sign-offs, actions
   done without a signature, open-before-confirm training, and SharePoint alerts and their resolution, through the UI
   as each persona: 110 of 110 checks pass, then the smoke test on the changed state (14 personas, 0 errors).
4. Walk the scenarios in `veqms/README.md` ("Try these in order"). Each one was tested end to end.
5. Reset the demo data afterwards (account menu → Reset demo data).

Untested so far: opening `index.html` straight from disk, Safari, Firefox, and screen readers.

## Demo personas

Switch with the account menu → **Demo · view as**. The main ones: Victoria E. (Quality Manager, approver),
PJ Walters (approver), Jim Speir (author), Louise Harvey (process owner), Daniel Greenwood (employee),
Lucy Parkin (System Administrator), Fraser Scott (auditor). Full table in `veqms/README.md`.

## What's simulated

Microsoft sign-in, Adobe Sign (agreements, the signing page with its identity check (any 6 digits work) and reason
for signing, webhook status, signed PDFs and audit reports), SharePoint (the Word file in the Drafts library is a
name and a last-edited time, and the stand-in editor plays Word; publishing, the delta sync, integrity alerts and the
hash check run in the browser), Teams, email, malware scanning, Office-to-PDF conversion and server-side PDFs. Other
integrations are switches and logs only.

## Signatures and training (added after the first build)

The app replaces KSTARRS. Every signature except read-and-understood training uses Adobe Sign (Adobe Acrobat Sign;
its Bio-Pharma settings make each signer confirm their identity and give a reason for signing, which supports
Part 11). Read-and-understood training stays in the app under the Microsoft 365 sign-in (not Part 11). This answers
open questions 5 and 29 in the spec; the user switched from DocuSign to Adobe Sign and extended it to every sign-off.
- One agreement per sign-off holds every signer, in order (for a document: author, reviewers, QA approver). One
  agreement = one transaction. Reasons for signing: Authored, Reviewed, Approved, Completed (action sign-offs).
- Transactions are counted against `settings.esign.allowance` (500, a placeholder until the Adobe Sign contract
  confirms it) per allowance year (`yearStartMonth`).
- Each document has an `audience` (groups, roles, users, days, quiz). Training rules no longer exist.
- Approvals before `settings.esign.goLive` are marked as migrated from KSTARRS.

## Amendment flow and SharePoint (aligned with the platform, data version 12)

PJ Walters' decisions of 24 November 2026, as the platform builds them (`platform/apps/api/src/services/documents.ts`,
`agreements.ts`, `sharepoint.ts`; `platform/docs/06` and `10`):
- Document states: Draft → In review → In approval → Signing → Effective (plus Superseded and Obsolete). "Review
  closed" is gone.
- Every amendment starts as a change request: creating a document or starting a new version opens one in execution
  (`forVersion: { doc, ver }`, linked both ways); it closes when that version is Effective. Full change control
  screens are Phase 2; these minimal ones have their own small view in `changes.js`.
- Authors edit the Word file in the SharePoint Drafts library. *Open in Word* opens the stand-in editor; saving
  clears a locked PDF (`v.pdf`, `v.verification`). There is no check-out any more.
- Submit in two steps: choose reviewers and QA approvers, then *Make the PDF* (hashed and locked, with a signature
  field per signer; segregation-of-duties problems are refused here and logged as `sod.block`); then open the PDF,
  tick the four checks and submit.
- Reviewers mark it reviewed; QA approvers approve in VeQMS and decide on retraining (yes by default; "no" needs a
  reason; retraining unless every approver said no, stored as `v.retrain`). Anyone on it, the owner, author or a
  Quality Manager can return it to the author while In review or In approval. The last approval sends the agreement;
  if it can't go (connector off, allowance used up) the approval isn't recorded. A decline or cancel returns it to
  Draft and undoes the approvals and the retraining decision.
- With no retraining, `Q.trainVersions(d)` keeps the replaced version's training counting: open allocations stay
  open and only people with no training on a counting version are allocated.
- A trainee must have opened the PDF of the record's version since allocation (`Q.logPdfOpen`, audited with the
  version) before `Q.completeTraining` accepts the confirmation.
- Document types include user access reviews (UAR) and risk assessments (RA), signed like vendor approvals.
- Administration → SharePoint: last sync of both libraries, publishing of each Effective version's locked PDF
  (superseded files stay, marked Superseded), integrity alerts (changed outside VeQMS, file missing, hash mismatch,
  publish failed) that notify Quality Managers and are audited, resolved by a Quality Manager with a note (final),
  *Sync now*, *Check hashes now* and *Simulate an outside edit*.

## Sensible next steps

- Get brand sign-off for the functional UI colours (greys, tints, status colours) and the marque favicon.
- Test in Safari and Firefox, and with VoiceOver.
- Port to Next.js + TypeScript per Step 1, keeping this prototype as the reference for screens and flows.
  Started: see "Full-stack platform" below.

## Full-stack platform (`platform/`)

The live build: PostgreSQL 16, a Fastify API, a Next.js web app and Azure UK South infrastructure, Phase 1 scope.
Start with `platform/README.md` and `platform/BUILD_PROMPT.md` (rules, first tasks, later phases, open decisions);
the documentation set is `platform/docs/01` to `09`. The prototype stays the reference for screens and flows.

- The database enforces the compliance rules (row-level security, append-only audit chain, insert-only signatures,
  locked training records, signatures only from Adobe Sign or KSTARRS, the Adobe Sign transaction allowance). Don't
  move a rule from SQL into the API only.
- Every signature goes through Adobe Sign except read-and-understood training (`platform/docs/06-adobe-sign.md`). The
  live Adobe Sign client hasn't run against Adobe Sign yet; its "Verify before go-live" list is in that doc.
- Checks: `npm run typecheck`, `npm test`, `npm run db:test` in `platform/`; browser tests in `platform/e2e` against
  `docker compose up --build`. CI is `.github/workflows/platform-ci.yml` (both jobs green on GitHub).
- Documents follow PJ Walters' amendment flow (24 Nov 2026): change request first; the PDF is made, hashed and locked at
  submit and the author checks it; review and approval in VeQMS (with the retraining decision); the last approval sends
  the Adobe Sign agreement. SharePoint is the file store: Word drafts, the locked PDF published to a controlled library,
  a delta sync raising integrity alerts (`platform/docs/10-sharepoint.md`, with its own "Verify before go-live" list).
- Status: built with the real packages (Next.js 16, zod 4, lockfile committed); every check and the ten UAT browser
  scenarios pass; the Bicep compiles. Not yet run: anything in Azure, Entra sign-in, live Adobe Sign, live SharePoint,
  Graph email.
  Deploys are manual only (`platform-deploy.yml`) until Azure is set up. Details: `platform/docs/07`.
