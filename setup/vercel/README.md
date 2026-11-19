# Vercel

`project-settings.json` lists every setting the original project used. Vercel keeps these in the
project, not in the code, so you enter them once when you import the repository.

## Dashboard steps (recommended)

1. Push the code to a GitHub repository in the new account first, keeping the folder structure.
2. Vercel → **Add New → Project** → import that repository. Vercel may ask you to install its GitHub
   app on the account or organisation.
3. **Root Directory:** `veqms`. If the picker doesn't offer `veqms`, the folder isn't on the branch
   Vercel is reading (usually `main`).
4. **Framework Preset:** Other. Leave the build, output and install commands empty.
5. Don't add any environment variables.
6. Click **Deploy**.
7. **Settings → Deployment Protection:** turn on Vercel Authentication and make sure it covers
   production, not only previews.
8. Open the site with the **Visit** button on the project's Overview page.

## Command-line route (optional)

`deploy-cli.sh` deploys the `veqms` folder with the Vercel CLI, without connecting GitHub. It needs
Node.js. With this route, Vercel doesn't redeploy when you push to GitHub; you run the script again.

## Things to check with Vercel

- Which deployment protection options your plan includes, and whether they cover production.
- The Hobby plan is for personal, non-commercial use, so a company project probably needs Pro.
- Whether your plan can import a private repository owned by a GitHub organisation.

If a plan needs paying for, pricing approval goes to PJ Walters.
