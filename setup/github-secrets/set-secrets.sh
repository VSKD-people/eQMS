#!/usr/bin/env bash
# Copies the Azure Static Web Apps deployment token into a GitHub Actions secret, without
# printing it or saving it to a file.
#
# Untested: check the commands against the current GitHub CLI and Azure CLI documentation.
# Needs: GitHub CLI (gh) signed in with access to the repository, and Azure CLI (az) signed in.
# Usage:  bash setup/github-secrets/set-secrets.sh <owner>/<repo> [static-web-app-name] [resource-group]
set -euo pipefail

REPO="${1:?Give the repository as owner/repo}"
SWA_NAME="${2:-veqms-prototype}"
RESOURCE_GROUP="${3:-rg-veqms-prototype}"

gh auth status >/dev/null

az staticwebapp secrets list --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" \
  --query properties.apiKey -o tsv \
  | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo "$REPO"

echo "Saved AZURE_STATIC_WEB_APPS_API_TOKEN to $REPO. Secrets now set:"
gh secret list --repo "$REPO"
