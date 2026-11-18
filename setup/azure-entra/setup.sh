#!/usr/bin/env bash
# Creates the Azure Static Web App and the Microsoft Entra ID app registration for VeQMS,
# connects them, and writes your tenant ID into veqms/staticwebapp.config.json.
#
# Untested: written without access to an Azure account. Check each command against the current
# Azure CLI documentation, and run it one section at a time the first time.
# Needs: Azure CLI (az), permission to create resources, and permission to register apps in Entra ID.
# Run from the top of the project folder:  bash setup/azure-entra/setup.sh
set -euo pipefail

# ---- Your choices --------------------------------------------------------------------------
RESOURCE_GROUP="rg-veqms-prototype"
SWA_NAME="veqms-prototype"          # becomes part of the site address
LOCATION="westeurope"               # check which Static Web Apps regions are offered and fit the residency answer (open question 8)
SKU="Standard"                      # tenant-restricted Entra sign-in needs Standard, as far as I know; check pricing first
APP_NAME="VeQMS prototype"
# ---------------------------------------------------------------------------------------------

cd "$(dirname "$0")/../.."
CONFIG="veqms/staticwebapp.config.json"

echo "== 1. Sign in to Azure"
az login
TENANT_ID="$(az account show --query tenantId -o tsv)"
echo "Tenant: $TENANT_ID"

echo "== 2. Create the resource group and the Static Web App"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
az staticwebapp create --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --location "$LOCATION" --sku "$SKU"
HOSTNAME="$(az staticwebapp show --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" --query defaultHostname -o tsv)"
echo "Site address: https://$HOSTNAME"

echo "== 3. Register the app in Entra ID (this tenant only)"
APP_ID="$(az ad app create \
  --display-name "$APP_NAME" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "https://$HOSTNAME/.auth/login/aad/callback" \
  --enable-id-token-issuance true \
  --query appId -o tsv)"
az ad sp create --id "$APP_ID" >/dev/null
echo "Application (client) ID: $APP_ID"

echo "== 4. Create a client secret and store it in the Static Web App settings"
# The secret goes straight into the app settings; it is not printed or saved to a file.
# It expires after a year: put a reminder in your calendar to renew it.
az staticwebapp appsettings set --name "$SWA_NAME" --resource-group "$RESOURCE_GROUP" \
  --setting-names "AZURE_CLIENT_ID=$APP_ID" \
  "AZURE_CLIENT_SECRET=$(az ad app credential reset --id "$APP_ID" --display-name "VeQMS Static Web App" --years 1 --query password -o tsv)" \
  >/dev/null

echo "== 5. Write the tenant ID into $CONFIG"
sed -i.bak "s/REPLACE_WITH_TENANT_ID/$TENANT_ID/" "$CONFIG" && rm -f "$CONFIG.bak"
grep -n "openIdIssuer" "$CONFIG"

# Optional: allow only named people or groups to sign in, rather than everyone in the tenant.
# Then add them in the Entra admin centre → Enterprise applications → VeQMS prototype → Users and groups.
# az ad sp update --id "$APP_ID" --set appRoleAssignmentRequired=true

echo
echo "Done. Next:"
echo "  1. Commit and push the change to $CONFIG (the tenant ID isn't a secret)."
echo "  2. Run setup/github-secrets/set-secrets.sh to give GitHub the deployment token."
echo "  3. Run the 'Deploy VeQMS prototype' workflow from the repository's Actions tab."
