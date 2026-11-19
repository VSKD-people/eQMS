#!/usr/bin/env bash
# Deploys the VeQMS app folder to Vercel with the Vercel CLI.
# Untested: check each command against Vercel's current CLI documentation before running.
# Run from the top of the project folder:  bash setup/vercel/deploy-cli.sh
set -euo pipefail

cd "$(dirname "$0")/../../veqms"

# 1. Install the CLI (needs Node.js) and sign in. Sign-in opens a browser.
npx vercel@latest login

# 2. Link this folder to a new or existing project. Answer the prompts:
#    - set up and deploy: yes
#    - which scope: your team
#    - link to existing project: no (first time), then choose a name
#    - in which directory is your code: ./   (you are already inside veqms)
#    - override settings: no
#    This writes a .vercel/ folder here. It is specific to your account: don't commit it.
npx vercel@latest link

# 3. Deploy to production.
npx vercel@latest deploy --prod

echo
echo "Done. Now turn on Settings → Deployment Protection in the Vercel dashboard (see README.md)."
