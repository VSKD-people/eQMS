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
| `js/engine.js` | Workflow engine `Q.wf.*` (doc, cr, obs, qe, capa, review, user), automation rules `Q.fire`, signatures, segregation of duties `Q.sodBlock`, training: audiences, allocation, `Q.completeTraining`, `Q.correctTraining`, `Q.trStatus` |
| `js/docusign.js` | Approvals through DocuSign `Q.ds.*`: `plan` (signers, order, problems), `cantSend`, `send` (verification check, one envelope = one send), `sign`, `decline`, `void`, completion (signed PDF, certificate, envelope ID), allowance `used`/`remaining` |
| `js/ui.js` | Router, shell, drawers, menus, Ctrl/Cmd+K palette, shared components, tour |
| `js/sign.js` | E-signature drawer `Q.sign` (Confirm → sign in again → Recorded) |
| `js/views/*.js` | One file per module: today, documents, training, changes, reviews, quality, analytics, admin, misc, approvals (send drawer, simulated DocuSign signing, envelope details, register) |
| `js/app.js` | Route table and boot. Loads last |

## Rules to keep

- **Escaping.** Build markup only with the `Q.h` tagged template; it escapes every interpolated value.
  Use `Q.raw(...)` only for markup you built yourself. Never put user text into `innerHTML` any other way.
- **Events.** No inline handlers. `data-act="name"` calls `Q.act[name](el, event)`. `data-change` and
  `data-input` call `Q.on[name]`. Drawer forms submit through `data-submit`.
- **State changes go through the engine.** Views call `Q.wf.*`; they never edit records directly. The engine
  writes the audit entry (`Q.audit`, hash-chained) and fires automation (`Q.fire`).
- **Two signing routes.** Approvals of controlled documents (incl. vendor approvals and validation plans and
  reports), CAPA closures and deviation closures go through DocuSign: call `Q.ds.openSend` / `Q.ds.send`, never
  change those records' state by hand; the envelope completing does it. Other signatures stay in the app: create
  them with `Q.makeSignature` via the `Q.sign` drawer, and check `Q.sodBlock` first. Signatures are insert-only.
- **Training records are locked once completed.** Only the trainee confirms (`Q.completeTraining`); dates come from
  the system; corrections are new records (`Q.correctTraining`). Change audiences with `Q.setAudience` so the change
  is logged with old and new values.
- **Permissions.** Gate actions with `Q.can(perm)` (roles map in `store.js`), and records with `Q.canSee` and
  `Q.canDownload`. The System Administrator can't approve; the auditor is read-only.
- **Sample data version.** After changing the shape of the data in `seed.js`, bump `version` in `seed.js` and
  the matching check in `Q.load` in `store.js` (both are `10`). Old browsers then reseed instead of breaking.
- **New script files** need a `<script>` tag in `index.html`, before `js/app.js`.
- **Design tokens** live at the top of `css/app.css` (light, dark, and `[data-theme]`). The Katalyze Data brand
  is applied: pink `#E2186F` fills (`--accent-fill`), purple `#940080` text accents (`--accent`), navy `#002B49` ink,
  Montserrat, and the logo in `img/` (primary on light, reversed on dark, via `--logo`). Neutral greys, tints and the
  overdue/due status colours are functional UI colours outside the brand palette and await brand sign-off.

## Check your work

1. Syntax: open the page and check the browser console for errors.
2. Smoke test: paste `tools/smoke-test.js` into the browser console (or run it with a browser tool).
   It renders every page, tab and record as every active persona, then checks the audit chain.
   The last run on this build: 13 personas, 3,822 renders, 0 errors, chain valid.
3. End-to-end test (optional, needs Node and Playwright): `node tools/e2e-test.js` with the app served on port 4173.
   It drives the DocuSign route and the training records through the UI as each persona: 56 checks.
4. Walk the scenarios in `veqms/README.md` ("Try these in order"). Each one was tested end to end.
5. Reset the demo data afterwards (account menu → Reset demo data).

Untested so far: opening `index.html` straight from disk, Safari, Firefox, and screen readers.

## Demo personas

Switch with the account menu → **Demo · view as**. The main ones: Victoria E. (Quality Manager, approver),
PJ Walters (approver), Jim Speir (author), Louise Harvey (process owner), Daniel Greenwood (employee),
Lucy Parkin (System Administrator), Fraser Scott (auditor). Full table in `veqms/README.md`.

## What's simulated

Microsoft sign-in and step-up re-authentication (any 6 digits work), DocuSign (envelopes, the signing page,
Connect status, signed PDFs and certificates), Teams, SharePoint, email, malware scanning, Office-to-PDF conversion
and server-side PDFs. Other integrations are switches and logs only.

## Signatures and training (added after the first build)

The app replaces KSTARRS. Approvals use DocuSign with the Part 11 module; read-and-understood training stays in
the app (not Part 11). This answers open questions 5 and 29 in the spec; both were still open.
- One envelope per version holds every signer, in order: author, reviewers, QA approver. One cycle = one send.
- Sends are counted against `settings.docusign.allowance` (500) per allowance year (`yearStartMonth`).
- Each document has an `audience` (groups, roles, users, days, quiz). Training rules no longer exist.
- Approvals before `settings.docusign.goLive` are marked as migrated from KSTARRS.

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
  locked training records, DocuSign allowance). Don't move a rule from SQL into the API only.
- Checks: `npm run typecheck`, `npm test`, `npm run db:test` in `platform/`; CI is `.github/workflows/platform-ci.yml`.
- Status when written: database and API logic run and tested against PostgreSQL 16; API and web type-checked
  against stand-in types only (npm was blocked in the build sandbox); nothing built with real packages or deployed.
