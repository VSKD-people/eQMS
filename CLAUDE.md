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
| `js/engine.js` | Workflow engine `Q.wf.*` (doc, cr, obs, qe, capa, review, rule, user), automation rules `Q.fire`, signatures, segregation of duties `Q.sodBlock` |
| `js/ui.js` | Router, shell, drawers, menus, Ctrl/Cmd+K palette, shared components, tour |
| `js/sign.js` | E-signature drawer `Q.sign` (Confirm → sign in again → Recorded) |
| `js/views/*.js` | One file per module: today, documents, training, changes, reviews, quality, analytics, admin, misc |
| `js/app.js` | Route table and boot. Loads last |

## Rules to keep

- **Escaping.** Build markup only with the `Q.h` tagged template; it escapes every interpolated value.
  Use `Q.raw(...)` only for markup you built yourself. Never put user text into `innerHTML` any other way.
- **Events.** No inline handlers. `data-act="name"` calls `Q.act[name](el, event)`. `data-change` and
  `data-input` call `Q.on[name]`. Drawer forms submit through `data-submit`.
- **State changes go through the engine.** Views call `Q.wf.*`; they never edit records directly. The engine
  writes the audit entry (`Q.audit`, hash-chained) and fires automation (`Q.fire`).
- **Signatures are insert-only.** Create them with `Q.makeSignature` via the `Q.sign` drawer. Check `Q.sodBlock`
  before letting anyone sign.
- **Permissions.** Gate actions with `Q.can(perm)` (roles map in `store.js`), and records with `Q.canSee` and
  `Q.canDownload`. The System Administrator can't approve; the auditor is read-only.
- **Sample data version.** After changing the shape of the data in `seed.js`, bump `version` in `seed.js` and
  the matching check in `Q.load` in `store.js` (both are `8`). Old browsers then reseed instead of breaking.
- **New script files** need a `<script>` tag in `index.html`, before `js/app.js`.
- **Design tokens** live at the top of `css/app.css` (light, dark, and `[data-theme]`). The Katalyze Data brand
  is applied: pink `#E2186F` fills (`--accent-fill`), purple `#940080` text accents (`--accent`), navy `#002B49` ink,
  Montserrat, and the logo in `img/` (primary on light, reversed on dark, via `--logo`). Neutral greys, tints and the
  overdue/due status colours are functional UI colours outside the brand palette and await brand sign-off.

## Check your work

1. Syntax: open the page and check the browser console for errors.
2. Smoke test: paste `tools/smoke-test.js` into the browser console (or run it with a browser tool).
   It renders every page, tab and record as every active persona, then checks the audit chain.
   The last run on this build: 13 personas, 3,315 renders, 0 errors, chain valid.
3. Walk the scenarios in `veqms/README.md` ("Try these in order"). Each one was tested end to end.
4. Reset the demo data afterwards (account menu → Reset demo data).

Untested so far: opening `index.html` straight from disk, Safari, Firefox, and screen readers.

## Demo personas

Switch with the account menu → **Demo · view as**. The main ones: Victoria E. (Quality Manager, approver),
Tom Hughes (approver), Sam Okafor (author), Grace Lim (process owner), Daniel Cruz (employee),
Hannah Weber (System Administrator), Alex Morgan (auditor). Full table in `veqms/README.md`.

## What's simulated

Microsoft sign-in and step-up re-authentication (any 6 digits work), Teams, SharePoint, DocuSign, email,
malware scanning, Office-to-PDF conversion and server-side PDFs. Integrations are switches and logs only.

## Sensible next steps

- Get brand sign-off for the functional UI colours (greys, tints, status colours) and the marque favicon.
- Test in Safari and Firefox, and with VoiceOver.
- Port to Next.js + TypeScript per Step 1, keeping this prototype as the reference for screens and flows.
