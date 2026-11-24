# Rebuilding VeQMS in another account

This folder holds everything needed to run, change and redeploy the VeQMS prototype from scratch:
the app code, the spec documents it was built from, the brand assets it uses, the deployment config
and the hand-over notes. Nothing else is needed, and no accounts, passwords or keys are stored in it.

## 1. Check the folder is complete

| Folder or file | What it is | Needed to run the app? |
|---|---|---|
| `veqms/` | The app: `index.html`, `css/app.css`, `js/` (16 scripts), `img/` (Katalyze Data logos) | Yes |
| `veqms/vercel.json` | Vercel settings: security headers, no search indexing | For Vercel only |
| `veqms/staticwebapp.config.json` | Azure Static Web Apps settings: Entra ID sign-in on every page | For Azure only |
| `.github/workflows/deploy-veqms.yml` | GitHub Actions job that deploys to Azure | For Azure only |
| `specs/` | The six spec documents, with plain-text copies in `specs/text/` | No, reference only |
| `setup/` | Settings, steps and scripts to recreate Vercel, Azure, Entra ID, and GitHub secrets | No, for set-up |
| `tools/smoke-test.js` | Renders every page as every persona and checks the audit chain | No, for testing |
| `CLAUDE.md` | Hand-over notes: architecture, code rules, how to test | No, read before changing code |
| `DEPLOY.md` | Step-by-step deployment to Vercel or Azure | No |
| `veqms/README.md` | 10-minute walkthrough and the demo personas | No |
| `.claude/launch.json` | Lets the Claude desktop app preview the app | No |

`.claude` and `.github` are hidden folders. On a Mac, press Cmd+Shift+. in Finder to see them.

## 2. Run it on your computer

You need Python 3 (built into macOS). There is no build step and no `npm install`. Open a terminal in
this folder and run:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory veqms
```

Then open http://localhost:4173. Fonts come from Google Fonts, so you need an internet connection for
Montserrat. Without one, the app falls back to Arial and still works.

## 3. Put it in a new GitHub repository

1. Create an empty private repository in the new GitHub account or organisation.
2. Upload the contents of this folder, keeping the folder structure. GitHub's web uploader flattens
   folders if you select files one by one, so either drag the whole folder in, or use git:

```bash
git init
```

```bash
git add -A
```

```bash
git commit -m "VeQMS prototype"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/<new-owner>/<new-repo>.git
```

```bash
git push -u origin main
```

3. Check that the repository shows the `veqms/`, `specs/` and `tools/` folders at the top level.

## 4. Deploy it

Pick one. Full steps are in `DEPLOY.md`.

**Vercel (quickest)**
1. Vercel → **Add New → Project** → import the new repository.
2. **Root Directory:** `veqms`. **Framework Preset:** Other. Leave the build, output and install commands
   empty. No environment variables are needed.
3. Deploy, then turn on **Settings → Deployment Protection** so only your team can open it.

**Azure Static Web Apps with Microsoft Entra ID sign-in (the target in the specs)**
Follow the Azure section of `DEPLOY.md`. You will need to:
- put the new tenant ID in `veqms/staticwebapp.config.json` (it currently holds a placeholder)
- add `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` to the Static Web App's settings
- add `AZURE_STATIC_WEB_APPS_API_TOKEN` as a GitHub Actions secret in the new repository

If you only use Vercel, the Azure workflow fails on each push to `main` because its secret is missing.
Disable it in the repository's **Actions** tab, or delete `.github/workflows/deploy-veqms.yml`.

## 5. Check it works

1. Open the site. You should land on **Today** with the guided tour.
2. Open the browser console (F12), paste in the contents of `tools/smoke-test.js` and press Enter.
   The expected result is 13 personas, 3,848 renders, 0 errors and a valid audit chain.
   Optional, if you have Node.js and Playwright: `node tools/e2e-test.js` runs 72 end-to-end checks of the
   Adobe Sign signing route and the training records.
3. Walk the scenarios in `veqms/README.md` under "Try these in order".

## 6. Carry on with Claude

Open this folder in a Claude Code session (desktop app, web or terminal). Claude reads `CLAUDE.md`
automatically. It covers how the code is organised, the rules to keep and how to test changes.

## Set-up kit (`setup/`)

| Folder | What it recreates |
|---|---|
| `setup/vercel/` | Vercel project settings (`project-settings.json`), dashboard steps and an optional CLI deploy script |
| `setup/azure-entra/` | Azure Static Web App and Entra ID app registration: portal steps and an Azure CLI script |
| `setup/github-secrets/` | The one GitHub Actions secret the Azure deploy needs: instructions and a set-up script |

The scripts haven't been tested against live accounts. Check the commands against each tool's current
documentation before running them. See `setup/README.md`.

## What is not in this folder

- **Account-held settings and secret values.** Vercel projects, Azure resources, Entra app registrations
  and GitHub secret values live in the accounts they were made in. `setup/` has the settings, steps and
  scripts to recreate each one (see the table below).
- **Demo data changes.** Each browser keeps its own copy of the sample data. It starts fresh in a new
  browser or after **Reset demo data**.
- **Git history.** It stays in the GitHub repository (`VSKD-people/eQMS`). Ask to be added as a collaborator
  to get it, or push this folder to a new repository as a fresh start (step 3).
- **Brand templates.** Only the three logo files the app uses are included (`veqms/img/`). The full
  Katalyze Data brand guidelines and templates are held separately.

## Open items carried over

- Brand sign-off for the functional UI colours (greys, tints, status colours), the standalone marque
  favicon, and semi-bold small labels. See `CLAUDE.md`.
- Spec open questions still open, including who approves Entra app registrations (question 10) and
  running costs (question 37). See `specs/eQMS — Open Questions (CONFIRM items).xlsx`.
- Not yet tested: Safari, Firefox, screen readers, and opening `index.html` straight from disk.
