# VeQMS prototype

A clickable, frontend-only prototype of the eQMS, plus the spec documents it was built from.
No database and no backend: sample data lives in the browser.

## What's in this folder

```
veqms-prototype/
├── README.md            this file
├── REBUILD.md           how to set it up again in another account (start here)
├── CLAUDE.md            hand-over notes Claude reads automatically: architecture, rules, how to test
├── veqms/               the app (open index.html through a local server, see below)
│   ├── index.html
│   ├── README.md        10-minute walkthrough and the demo users
│   ├── css/app.css
│   ├── img/             Katalyze Data logos
│   ├── js/              core, seed data, store, workflow engine, UI, signing, views/
│   ├── vercel.json      Vercel settings
│   └── staticwebapp.config.json   Azure Static Web Apps settings (Entra ID sign-in)
├── specs/               the six spec documents (build prompt, Steps 1–3, open questions, index)
│   └── text/            plain-text copies of the PDFs and spreadsheets
├── tools/
│   └── smoke-test.js    paste into the browser console to check every page renders
├── .claude/
│   └── launch.json      lets the Claude desktop app preview the app in its browser pane
├── .github/workflows/   deploys veqms/ to Azure Static Web Apps
└── DEPLOY.md            how to put it online: Vercel (interim) or Azure with Entra ID sign-in
```

`.claude` is a hidden folder. On a Mac, press Cmd+Shift+. in Finder to see it.

## Run it

You need Python 3, which comes with macOS. Open Terminal in this folder and run:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory veqms
```

Then open http://localhost:4173 in your browser. Press Ctrl+C in Terminal to stop it.

## Carry on with Claude on another device

1. Unzip this folder somewhere you keep projects, for example `~/Projects/veqms-prototype`.
2. In the Claude desktop app, start a new Code session and choose this folder. Or run `claude` in Terminal from inside it.
3. Ask Claude to read `CLAUDE.md` and continue. It covers how the code is organised, the rules to keep
   and how to check changes.
4. Ask it to start the `veqms` preview to see the app in its browser pane.
