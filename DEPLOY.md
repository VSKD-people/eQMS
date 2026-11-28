# Deploying the VeQMS prototype

## Quick option: Vercel (interim)

Use this to get a link quickly. It is not the target platform: the specs settle on Azure, and Vercel
sign-in is not Entra ID unless you're on a plan that includes SAML SSO.

1. Sign in at vercel.com and choose **Add New → Project**. Import `VSKD-people/eQMS` from GitHub.
   Vercel may ask you to install its GitHub app on the organisation first.
2. Set **Root Directory** to `veqms`. Set **Framework Preset** to **Other**. Leave the build command and
   output directory empty, because there's no build step.
3. Deploy. `veqms/vercel.json` adds basic security headers and asks search engines not to index the site.
4. Restrict access under **Project → Settings → Deployment Protection**. **Vercel Authentication**
   lets only members of your Vercel team open the site. Make sure it covers the production URL as well as
   preview deployments. Password protection and SAML SSO (for example with Entra ID) depend on your plan.

Check against Vercel's current documentation and pricing:

- which protection options your plan includes, and whether they cover production deployments
- that the Hobby plan is for personal, non-commercial use, so a company project probably needs Pro
- whether your plan can import a private repository owned by a GitHub organisation

Notes:

- The site holds only the prototype's built-in sample data. Nothing a user enters leaves their browser.
- Vercel deploys a preview for every branch push, and production from the default branch.
- The Azure workflow below also runs on pushes to `main`. It fails harmlessly until its secret is
  added, or you can disable it in the GitHub Actions tab.

---

# Target option: Azure Static Web Apps with Microsoft Entra ID sign-in

This puts the prototype on a web address that only people in your Microsoft Entra ID tenant can open.
They sign in with their normal Microsoft 365 account.

**What this does and doesn't do.** Entra ID only guards the door. Once someone is in, the prototype
works as it does locally: sample data lives in each person's browser, nobody sees anyone else's
changes, and the sign-in, Adobe Sign and the other integrations inside the app are still simulated. Switch
personas from the account menu → **Demo · view as**.

## Why Azure Static Web Apps

The specs already settle the platform: Azure (open question 7), UK and Europe (question 8), lowest
cost (question 34), and Entra ID as the working SSO assumption (question 10). The prototype is a set
of static files, so a static host with sign-in built in fits it.

## What's in the repo

| File | Purpose |
|---|---|
| `veqms/staticwebapp.config.json` | Requires an Entra ID sign-in for every page, and sends anyone not signed in to the Microsoft login |
| `.github/workflows/deploy-veqms.yml` | Deploys `veqms/` when changes reach `main`, or when started by hand from the Actions tab |

## Steps

You'll need rights to create Azure resources, and an Entra admin (or someone allowed to register apps)
for step 2. Open question 10 ("Who approves app registrations?") is still open, so confirm that first.

### 1. Create the Static Web App

1. In the Azure portal, create a **Static Web App**.
2. **Plan: Standard.** Restricting sign-in to your own tenant needs a custom Entra registration, and
   as far as I know that is a Standard plan feature. On the Free plan, any Microsoft account could
   sign in. Check the current pricing and plan features on Microsoft's Static Web Apps pricing page
   before you commit, and get budget approval if needed.
3. **Region:** choose the one closest to the UK from the list offered. The static files are served
   from a global network, so this mainly decides where the app's settings sit. Check the region
   against the residency answer for question 8.
4. **Deployment source:** choose **Other**. The workflow already exists, so you don't want Azure adding
   a second one to the repo.
5. Once it's created, note the site's address (`https://<name>.azurestaticapps.net`), then open
   **Manage deployment token** and copy the token.

### 2. Register the app in Entra ID

1. Entra admin centre → **App registrations** → **New registration**.
2. Name: `VeQMS prototype`. Supported account types: **this organisational directory only**.
3. Redirect URI (Web): `https://<name>.azurestaticapps.net/.auth/login/aad/callback`
4. Under **Authentication**, tick **ID tokens**.
5. Under **Certificates & secrets**, create a client secret and copy its value. Note when it expires.
6. From **Overview**, copy the **Application (client) ID** and the **Directory (tenant) ID**.

Optional: to limit access to particular people rather than the whole tenant, go to
**Enterprise applications → VeQMS prototype → Properties**, set **Assignment required** to **Yes**,
and add those people under **Users and groups**.

### 3. Connect the two

1. In the Static Web App, open **Environment variables** (also called application settings) and add:
   - `AZURE_CLIENT_ID`: the Application (client) ID
   - `AZURE_CLIENT_SECRET`: the client secret value
2. In `veqms/staticwebapp.config.json`, replace `REPLACE_WITH_TENANT_ID` with the Directory (tenant) ID.
   The tenant ID isn't a secret, so it can be committed.
3. In GitHub → repo **Settings → Secrets and variables → Actions**, add a secret named
   `AZURE_STATIC_WEB_APPS_API_TOKEN` and paste in the deployment token from step 1.

### 4. Deploy

Merge the branch into `main`, or run **Deploy VeQMS prototype** by hand from the GitHub **Actions** tab.
Then open the site address. You should be sent to the Microsoft login and land on the **Today** page.

## Checks after deploying

- In a private browser window, the site goes straight to the Microsoft login.
- An account from outside your tenant is refused.
- Once you're signed in, run `tools/smoke-test.js` in the browser console. The expected result is
  13 personas, 3,822 renders, 0 errors and a valid audit chain.

## Things to verify

These come from my knowledge of Azure. They weren't tested from here, and Azure changes often, so
check them against Microsoft's current Static Web Apps documentation:

- that custom Entra authentication needs the Standard plan
- the redirect URI format and the ID tokens setting
- the region list and where application settings are stored
