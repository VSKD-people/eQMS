# Azure Static Web Apps and Microsoft Entra ID

This is the target set-up in the specs: Azure hosting, with only people in your Microsoft tenant able
to sign in. It hasn't been set up in the original account yet, so there are no existing settings to
copy; this folder creates them from scratch.

## Files involved

| File | Role |
|---|---|
| `setup/azure-entra/setup.sh` | Creates the Static Web App and Entra app registration with the Azure CLI, connects them, and fills in the tenant ID |
| `veqms/staticwebapp.config.json` | Requires sign-in on every page. Holds the placeholder `REPLACE_WITH_TENANT_ID` until set-up |
| `.github/workflows/deploy-veqms.yml` | Deploys `veqms/` on each push to `main`, or when run by hand |

## Before you start

- Get approval for the app registration. Open question 10 ("who approves app registrations?") is still open.
- Check the Static Web Apps pricing. The script uses the Standard plan because, as far as I know,
  restricting sign-in to one tenant needs it. Pricing approval goes to PJ Walters.

## Option A: script

```bash
bash setup/azure-entra/setup.sh
```

Edit the names and region at the top of the script first.

## Option B: portal

The same steps by hand are in the Azure section of `DEPLOY.md` at the top of the project folder.

## Settings created

| Where | Setting | Value |
|---|---|---|
| Static Web App | Plan | Standard |
| Static Web App | App setting `AZURE_CLIENT_ID` | Application (client) ID of the app registration |
| Static Web App | App setting `AZURE_CLIENT_SECRET` | Client secret value (expires; renew yearly) |
| Entra app registration | Supported accounts | This organisational directory only |
| Entra app registration | Redirect URI (Web) | `https://<site address>/.auth/login/aad/callback` |
| Entra app registration | ID tokens | On |
| Enterprise application | Assignment required | Optional: Yes, to allow named people only |
| `staticwebapp.config.json` | `openIdIssuer` | `https://login.microsoftonline.com/<tenant ID>/v2.0` |
| GitHub repository | Secret `AZURE_STATIC_WEB_APPS_API_TOKEN` | See `setup/github-secrets/` |

## Check it works

1. In a private browser window, the site goes straight to the Microsoft sign-in.
2. An account from outside your tenant is refused.
3. Once signed in, `tools/smoke-test.js` in the browser console gives 13 personas, 3,315 renders,
   0 errors and a valid audit chain.
