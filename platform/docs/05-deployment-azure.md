# 05 · Deploying VeQMS to Azure UK South

This takes an empty Azure subscription to a live VeQMS with Microsoft Entra ID sign-in, PostgreSQL, DocuSign
approvals and daily training reminders.

> **Status: not tested in Azure.** Both Dockerfiles build and run locally (`docker compose up --build`, with the UAT
> browser tests passing against it). The infrastructure code (`infra/`) and the deploy workflow were written without
> access to Azure, the Bicep compiler or a container registry. Treat the first deployment as a dry run in a
> non-production subscription, and fix anything the tools reject before you deploy to production.
> Each step below says what still needs checking.

## What you end up with

| Part | Azure resource | Notes |
|---|---|---|
| Web app (Next.js) | Container app `veqms-web`, public HTTPS | Signs people in with Entra ID; calls the API server to server |
| API (Node) | Container app `veqms-api` | Only component that touches the database. Public HTTPS address if `apiExternal = true` (needed for DocuSign Connect and SCIM, see step 9) |
| Migrations | Container Apps job `veqms-migrate` (manual) | Run by every deployment before the apps update |
| Training reminders | Container Apps job `veqms-reminders` | Daily at 06:00 UTC |
| Database | Azure Database for PostgreSQL Flexible Server 16, database `veqms` | Private network only, Entra authentication only, 35-day backups copied to UK West |
| Files | Storage account, container `records` | Original PDFs, signed PDFs, certificates of completion; time-based retention policy |
| Secrets | Key Vault (RBAC) | Names only in code; values added by hand |
| Images | Azure Container Registry | Tagged with the Git commit |
| Logs | Log Analytics | Container logs and job runs |
| Identities | `id-veqms-app`, `id-veqms-web`, `id-veqms-migrate` | One managed identity per job, least privilege |

## 1. Before you start

**Decisions and approvals**

| Item | Who | Status |
|---|---|---|
| Azure subscription and budget | Finance / IT | Running costs need approval. Send pricing questions to **PJ Walters**. Check costs in the Azure pricing calculator for the SKUs in `main.parameters.json`; this guide does not quote prices. |
| Who approves Entra ID app registrations | IT | **Open question 10** in the spec. Settle it before step 3. |
| Data residency | IT + Legal / DPO | Spec open question 8: UK South primary, backups to UK West. Confirm geo-redundant backup lands in UK West for your subscription. |
| DocuSign account with API access and the Part 11 module | Quality + Finance | Confirm with DocuSign that the account has API access and the Part 11 module, and the yearly envelope allowance (the app assumes 500). |
| Who reviews production deployments | Quality Manager | Set as required reviewers on the GitHub `production` environment. |

**People and access**

- An Azure user with **Owner** on the target resource group (Bicep creates role assignments).
- An Entra ID administrator who can register applications and grant admin consent.
- A GitHub repository administrator.

**Tools on your computer**: Azure CLI with Bicep (`az bicep version`), the Container Apps extension
(`az extension add --name containerapp`), `openssl`, and Git.

## 2. Resource group

```bash
az login
```

```bash
az account set --subscription "<subscription name or id>"
```

```bash
az group create --name rg-veqms-prod --location uksouth --tags system=VeQMS environment=production
```

## 3. Entra ID app registrations

Create these in the Entra admin centre (App registrations → New registration). Account type: **this
organisational directory only**.

**3a. API: `VeQMS API`**
1. Expose an API → set the Application ID URI (the default `api://<client-id>` is fine).
2. Add a scope `access_as_user`, who can consent: admins and users, enabled.
3. Manifest: set `requestedAccessTokenVersion` (shown as `accessTokenAcceptedVersion` in older manifests) to `2`.
   With v2 tokens the audience (`aud`) is the API's client ID, so use the **client ID** as `entraApiAudience`.
   *Check:* decode a real access token at sign-in and confirm `aud` matches what the API expects.
4. No client secret is needed for the API.

**3b. Web: `VeQMS web`**
1. Authentication → add a **Web** platform, redirect URI `https://<web host>/auth/callback`. You get the host in
   step 4 (or use your custom domain from step 10). Front-channel logout URL: `https://<web host>/auth/logout`.
2. Certificates & secrets → new client secret, 12 months. Copy the value straight into Key Vault in step 5; put a
   renewal reminder in the runbook calendar.
3. API permissions → add **VeQMS API → access_as_user** (delegated), plus `openid`, `profile`, `offline_access`,
   `email`. Grant admin consent.
4. Note the client ID for `entraWebClientId`, and the scope `api://<api-client-id>/access_as_user` for `entraApiScope`.

**3c. Database administrators group (optional, recommended)**: an Entra security group whose members can
administer PostgreSQL for restores and investigations. Note its object ID and name.

**3d. Deployment identity for GitHub** (step 7): an app registration `VeQMS deploy` with a federated credential.

## 4. Deploy the infrastructure (phase 1)

```bash
cp infra/main.parameters.example.json infra/main.parameters.json
```

Edit `infra/main.parameters.json`: Entra IDs from step 3, `deployApps: false`, `docusignMode: "mock"` for now, and
`apiExternal: true` unless the web app proxies `/webhooks/docusign` and `/scim/v2` (it doesn't in Phase 1).

Validate first. These commands were not run while writing this guide:

```bash
az bicep build --file infra/main.bicep
```

```bash
az deployment group what-if --resource-group rg-veqms-prod --template-file infra/main.bicep --parameters @infra/main.parameters.json
```

Fix anything the build or what-if reports (API versions, property names). Then deploy:

```bash
az deployment group create --resource-group rg-veqms-prod --name veqms-phase1 --template-file infra/main.bicep --parameters @infra/main.parameters.json
```

Keep the outputs: `registryName`, `keyVaultName`, `postgresFqdn`, `appIdentityName`, `migrateIdentityName`,
`webUrl`, `apiInternalUrl`.

```bash
az deployment group show --resource-group rg-veqms-prod --name veqms-phase1 --query properties.outputs
```

Notes:
- Geo-redundant backup can only be set when the server is created. Check it shows **Enabled** before you load data.
- The `records` container's retention policy is deliberately **unlocked**. Lock it only once the retention period is
  agreed and validation is complete; locking can't be undone.
- If the storage firewall rejects the service endpoint on the delegated apps subnet, switch to a private endpoint for
  blob storage.

## 5. Key Vault secrets

Give yourself permission to write secrets (Key Vault Secrets Officer on the vault), then add the five secrets the
apps reference. The apps fail to start if any is missing.

```bash
KV=<keyVaultName from the outputs>
```

```bash
az keyvault secret set --vault-name "$KV" --name session-secret --value "$(openssl rand -base64 32)"
```

```bash
az keyvault secret set --vault-name "$KV" --name scim-token --value "$(openssl rand -hex 32)"
```

```bash
az keyvault secret set --vault-name "$KV" --name entra-web-client-secret --value "<web client secret from step 3b>"
```

While DocuSign is in mock mode, the two DocuSign secrets still need to exist:

```bash
az keyvault secret set --vault-name "$KV" --name docusign-private-key --value "not-used-in-mock-mode"
```

```bash
az keyvault secret set --vault-name "$KV" --name docusign-connect-hmac-keys --value "$(openssl rand -hex 32)"
```

Keep the SCIM token somewhere safe for step 9; it's the only time you'll see it outside Key Vault.

## 6. First images and the apps (phase 2)

The deploy workflow updates existing apps, so the first images are built by hand. `az acr build` builds in Azure,
so you don't need Docker locally. Run from the `platform/` folder:

```bash
ACR=<registryName from the outputs>
```

```bash
az acr build --registry "$ACR" --image veqms-api:initial --file apps/api/Dockerfile .
```

```bash
az acr build --registry "$ACR" --image veqms-web:initial --file apps/web/Dockerfile .
```

The first build installs packages without a lockfile. After it works, run `npm install` locally, commit
`package-lock.json`, and builds become reproducible.

Then deploy again with the apps switched on and the real images:

```bash
az deployment group create --resource-group rg-veqms-prod --name veqms-phase2 --template-file infra/main.bicep --parameters @infra/main.parameters.json --parameters deployApps=true apiImage=$ACR.azurecr.io/veqms-api:initial webImage=$ACR.azurecr.io/veqms-web:initial
```

Role assignments can take a few minutes to take effect. If a revision fails with an image-pull or Key Vault error,
wait five minutes and restart the revision.

## 7. Database: migrations and the API's login

The database has no public address, so all database work runs inside the environment as the `veqms-migrate` job.
It runs the migrations as the PostgreSQL Entra administrator, then makes sure the API identity has a database login
and is a member of `veqms_app` (row-level security applies; it can never DELETE).

```bash
az containerapp job start --name veqms-migrate --resource-group rg-veqms-prod
```

```bash
az containerapp job execution list --name veqms-migrate --resource-group rg-veqms-prod --output table
```

Check the logs in Log Analytics if it fails. **Check before first use:** `infra/scripts/grant-app-role.mjs` calls
`pgaadauth_create_principal`, Azure's function for Entra-mapped roles; confirm the name and arguments in
Microsoft's current documentation. The migrations need the `pgcrypto` extension, which the Bicep allow-lists
through the `azure.extensions` server parameter.

Never run the demo seed (`seed.js`) against production; it refuses unless forced.

**Create the first tenant.** Production starts with no tenant. Ask a database administrator (member of the group from
step 3c, connecting from a jump host or Bastion in the VNet) to insert one row each into `app.tenants`,
`app.tenant_directory` (your Entra tenant ID) and `app.settings`, then add the first Quality Manager and System
Administrator. After that, SCIM provisioning (step 9) brings in everyone else. Record this as a change under your
change-control procedure.

## 8. GitHub: automatic deployments

1. On the `VeQMS deploy` app registration (step 3d), add a federated credential: issuer
   `https://token.actions.githubusercontent.com`, subject `repo:<owner>/<repo>:environment:production`, audience
   `api://AzureADTokenExchange`.
2. Give it **AcrPush** on the registry and **Contributor** on the resource group. Nothing more.
3. In GitHub → Settings → Environments, create `production`, add the required reviewers, and restrict it to `main`.
4. Add these as environment variables (not secrets; OIDC means there's no Azure password to store):
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `ACR_NAME`.

From then on, run `.github/workflows/platform-deploy.yml` by hand (Actions > Platform deploy > Run workflow): build,
push, migrate (it waits for success), then roll out the API, web app and reminders job, and a smoke check. It is
manual only until Azure is set up; once it is, decide whether merges to `main` should deploy automatically, and if
so make the deploy wait for CI. CI (`platform-ci.yml`) runs on every pull request. *Check:* the status values the migrate loop waits for
(`Succeeded`, `Failed`) against `az containerapp job execution show`.

## 9. Integrations

**DocuSign (approvals, Part 11 module).** Start in the DocuSign developer (demo) environment.
1. Apps and Keys → add an app (integration key). Generate an RSA keypair; keep the private key only in Key Vault.
2. Choose the API user the app acts as. Grant consent once by visiting the consent URL for the JWT grant with scopes
   `signature impersonation` (follow DocuSign's current JWT grant guide for the exact URL).
3. Note the user ID, account ID and base URI (from the userinfo call, e.g. `https://demo.docusign.net`).
4. Connect → add a configuration: URL `https://<api host>/webhooks/docusign`, JSON payload, envelope and recipient
   events (sent, delivered, completed, declined, voided), **HMAC** on. Put the HMAC key in Key Vault as
   `docusign-connect-hmac-keys`.
5. Confirm with DocuSign that the **Part 11 module** is enabled on the account (signer re-authentication and
   signature meaning).
6. Set the secrets and parameters (`docusignMode: live`, integration key, user ID, account ID, base URI), redeploy,
   and send a test envelope on a test document.
7. **Go-live:** DocuSign reviews the integration before it can use the production environment. After approval, change
   `docusignAuthServer` to `account.docusign.com`, use the production account and base URI, register a new Connect
   configuration, and rotate the keys.

Every send counts against the allowance (500 a year by default; change it in Settings). Watch it as described in
the runbook.

**Entra ID provisioning (SCIM).** Enterprise applications → New application → create your own (non-gallery) →
Provisioning → Automatic. Tenant URL `https://<api host>/scim/v2`, secret token = `scim-token`. Map users and the
groups that drive training audiences (All staff, IT team, Managers, …), test the connection, provision a test user,
then run Microsoft's SCIM validator against the endpoint before switching on for everyone.

**Email (optional).** To send email from the shared QMS mailbox, grant the API identity `Mail.Send` limited to that
mailbox (Exchange RBAC for Applications, spec open question 14) and set `graphMailFrom`. Leave it empty for in-app
notifications only.

## 10. Custom domain and certificate

1. Add DNS records for your chosen host (e.g. `qms.example.co.uk`): a CNAME to the web app's default address and the
   TXT verification record Azure asks for.
2. Add the hostname to `veqms-web` and bind a free managed certificate:

```bash
az containerapp hostname add --name veqms-web --resource-group rg-veqms-prod --hostname qms.example.co.uk
```

```bash
az containerapp hostname bind --name veqms-web --resource-group rg-veqms-prod --hostname qms.example.co.uk --environment <environmentName> --validation-method CNAME
```

3. Update the web app registration's redirect URI, set `appBaseUrl` to `https://qms.example.co.uk`, and redeploy.
   Do the same for an API hostname if DocuSign and SCIM should use your domain.

*Check* the `hostname bind` options against the current Azure CLI reference.

## 11. Smoke checks

- [ ] `https://<web host>/` redirects to the Microsoft sign-in, and a user outside your tenant is refused.
- [ ] After sign-in, Today loads, and `/api/v1/me` shows the right roles.
- [ ] `GET <api>/ready` returns `{ "ok": true }`.
- [ ] `GET /api/v1/audit/verify` (as Quality Manager) returns `ok: true`.
- [ ] Create a test document, submit it, review it, send it to DocuSign (demo), sign as each signer: it becomes
      Effective, the signed PDF and certificate download, and the author and reviewers have completed training records.
- [ ] A trainee confirms read and understood; the record shows system time and can't be changed.
- [ ] The sends counter went up by one per envelope.
- [ ] The reminders job ran at 06:00 UTC (job execution history).
- [ ] Container logs reach Log Analytics; no secrets in the logs.

## Not tested, check before relying on it

- Every Bicep resource API version and property; the PostgreSQL `version: '16'` with API version 2024-08-01.
- Container Apps workload-profile networking with the /23 delegated subnet and the storage service endpoint.
- The storage immutability approach (container-level time-based policy vs version-level WORM vs legal hold).
- `pgaadauth_create_principal` and the managed-identity token endpoint used by `infra/scripts`.
- `az containerapp job start/execution show` behaviour and status values in the deploy workflow.
- The Dockerfiles (no npm or registry access while writing): the web image assumes Next.js `output: 'standalone'`
  with `outputFileTracingRoot` set to the `platform/` folder.
- DocuSign JWT grant, Connect and Part 11 module settings, which depend on your DocuSign account.
