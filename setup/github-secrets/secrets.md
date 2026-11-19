# GitHub secrets

GitHub never shows a secret's value after it is saved, so secrets can't be exported or copied between
accounts. You create them again in the new repository. No secrets were ever set in the original
repository: the Azure set-up hasn't been done yet.

## Secrets the repository uses

| Name | Used by | Where the value comes from | Needed for Vercel? |
|---|---|---|---|
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | `.github/workflows/deploy-veqms.yml` | Azure portal → the Static Web App → **Manage deployment token** | No |

That is the only one. The Entra client ID and secret are not GitHub secrets: they go into the Static
Web App's own settings (see `setup/azure-entra/`).

## Setting it

**Script:** `set-secrets.sh` reads the token from Azure and saves it to GitHub without printing it.

```bash
bash setup/github-secrets/set-secrets.sh <new-owner>/<new-repo>
```

**By hand:** GitHub → the repository → **Settings → Secrets and variables → Actions → New repository
secret**. Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`. Value: the deployment token.

## If you only use Vercel

You don't need any secrets. The Azure workflow then fails on each push to `main`; disable it in the
repository's **Actions** tab, or delete `.github/workflows/deploy-veqms.yml`.
