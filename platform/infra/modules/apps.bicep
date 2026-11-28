// Container apps and jobs: veqms-api (internal ingress), veqms-web (public HTTPS), veqms-migrate (manual job)
// veqms-reminders (daily at 06:00 UTC), veqms-anchor (audit anchors, every 15 minutes by default) and veqms-sharepoint
// (publishing and the SharePoint delta sync, every 15 minutes by default). Secrets come from Key Vault through managed identities; nothing
// secret is written here. NOT VALIDATED: check with `az bicep build` and what-if before first use.

param location string
param tags object
param environmentId string
param registryServer string
param keyVaultUri string
param appIdentityId string
param appIdentityClientId string
param appIdentityName string
param webIdentityId string
param migrateIdentityId string
param migrateIdentityClientId string
param migrateIdentityName string
param postgresFqdn string
param storageAccountUrl string
param apiImage string
param webImage string
param appBaseUrl string
param apiInternalUrl string
param entraTenantId string
param entraApiAudience string
param entraWebClientId string
param entraApiScope string
param esignMode string
param adobeSignAuth string
param adobeSignApiAccessPoint string
param adobeSignClientId string
param graphMailFrom string
param sharepointMode string
param sharepointSiteId string
param sharepointDraftsDriveId string
param sharepointControlledDriveId string
param sharepointColumns string

@description('How often the SharePoint job publishes waiting versions and syncs both libraries (cron, UTC).')
param sharePointSyncCron string = '*/15 * * * *'

@description('How often the audit anchor job writes the chain head to the records container (cron, UTC). Every 15 minutes by default, as Step 1 proposes; the interval is open decision R4.')
param auditAnchorCron string = '*/15 * * * *'

@description('false: the API is reachable only inside the environment. Adobe Sign webhooks and Entra SCIM must reach /webhooks/adobe-sign/<token> and /scim/v2 from the internet, so either set this true (API gets its own public HTTPS address; every route still needs a bearer token, the webhook token or the SCIM token) or proxy those two paths through the web app.')
param apiExternal bool = false

// With Entra authentication the database user name is the identity's name; the password is a short-lived token.
var appDatabaseUrl = 'postgres://${appIdentityName}@${postgresFqdn}:5432/veqms?sslmode=require'
var migrateDatabaseUrl = 'postgres://${migrateIdentityName}@${postgresFqdn}:5432/veqms?sslmode=require'

// Key Vault secret names (create them before deploying this module; see docs/05-deployment-azure.md).
var apiSecrets = [
  // Create all four Adobe Sign secrets; put a placeholder in the credential you don't use (oauth or integration key).
  { name: 'adobe-sign-client-secret', keyVaultUrl: '${keyVaultUri}secrets/adobe-sign-client-secret', identity: appIdentityId }
  { name: 'adobe-sign-refresh-token', keyVaultUrl: '${keyVaultUri}secrets/adobe-sign-refresh-token', identity: appIdentityId }
  { name: 'adobe-sign-integration-key', keyVaultUrl: '${keyVaultUri}secrets/adobe-sign-integration-key', identity: appIdentityId }
  { name: 'adobe-sign-webhook-token', keyVaultUrl: '${keyVaultUri}secrets/adobe-sign-webhook-token', identity: appIdentityId }
  { name: 'scim-token', keyVaultUrl: '${keyVaultUri}secrets/scim-token', identity: appIdentityId }
]
var webSecrets = [
  { name: 'entra-web-client-secret', keyVaultUrl: '${keyVaultUri}secrets/entra-web-client-secret', identity: webIdentityId }
  { name: 'session-secret', keyVaultUrl: '${keyVaultUri}secrets/session-secret', identity: webIdentityId }
]

var apiEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'PORT', value: '8080' }
  { name: 'DATABASE_URL', value: appDatabaseUrl }
  { name: 'DATABASE_ENTRA_AUTH', value: '1' }
  { name: 'AZURE_CLIENT_ID', value: appIdentityClientId }
  { name: 'ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'ENTRA_API_AUDIENCE', value: entraApiAudience }
  { name: 'DEV_AUTH', value: '0' }
  { name: 'ADOBE_SIGN_MODE', value: esignMode }
  { name: 'ADOBE_SIGN_AUTH', value: adobeSignAuth }
  { name: 'ADOBE_SIGN_API_ACCESS_POINT', value: adobeSignApiAccessPoint }
  { name: 'ADOBE_SIGN_CLIENT_ID', value: adobeSignClientId }
  { name: 'ADOBE_SIGN_CLIENT_SECRET', secretRef: 'adobe-sign-client-secret' }
  { name: 'ADOBE_SIGN_REFRESH_TOKEN', secretRef: 'adobe-sign-refresh-token' }
  { name: 'ADOBE_SIGN_INTEGRATION_KEY', secretRef: 'adobe-sign-integration-key' }
  { name: 'ADOBE_SIGN_WEBHOOK_TOKEN', secretRef: 'adobe-sign-webhook-token' }
  { name: 'STORAGE_MODE', value: 'azure' }
  { name: 'STORAGE_ACCOUNT_URL', value: storageAccountUrl }
  { name: 'STORAGE_CONTAINER', value: 'records' }
  { name: 'SCIM_TOKEN', secretRef: 'scim-token' }
  { name: 'GRAPH_MAIL_FROM', value: graphMailFrom }
  { name: 'APP_BASE_URL', value: appBaseUrl }
  { name: 'SHAREPOINT_MODE', value: sharepointMode }
  { name: 'SHAREPOINT_SITE_ID', value: sharepointSiteId }
  { name: 'SHAREPOINT_DRAFTS_DRIVE_ID', value: sharepointDraftsDriveId }
  { name: 'SHAREPOINT_CONTROLLED_DRIVE_ID', value: sharepointControlledDriveId }
  // Changes by this app ID are VeQMS's own. Verify that Graph reports the managed identity's client ID in
  // lastModifiedBy.application.id (docs/10-sharepoint.md).
  { name: 'SHAREPOINT_APP_ID', value: appIdentityClientId }
  { name: 'SHAREPOINT_COLUMNS', value: sharepointColumns }
]

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'veqms-api'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${appIdentityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: apiExternal
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [ { server: registryServer, identity: appIdentityId } ]
      secrets: apiSecrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: apiEnv
          probes: [
            { type: 'Liveness', httpGet: { path: '/health', port: 8080 }, periodSeconds: 30 }
            { type: 'Readiness', httpGet: { path: '/ready', port: 8080 }, periodSeconds: 15 }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'veqms-web'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${webIdentityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false // HTTPS only
      }
      registries: [ { server: registryServer, identity: webIdentityId } ]
      secrets: webSecrets
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'API_BASE_URL', value: apiInternalUrl }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'ENTRA_WEB_CLIENT_ID', value: entraWebClientId }
            { name: 'ENTRA_WEB_CLIENT_SECRET', secretRef: 'entra-web-client-secret' }
            { name: 'ENTRA_API_SCOPE', value: entraApiScope }
            { name: 'SESSION_SECRET', secretRef: 'session-secret' }
            { name: 'APP_BASE_URL', value: appBaseUrl }
            { name: 'DEV_AUTH', value: '0' }
          ]
          probes: [
            { type: 'Liveness', tcpSocket: { port: 3000 }, periodSeconds: 30 }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// Runs migrations as the PostgreSQL Entra administrator, then makes sure the API identity has its database login
// (member of veqms_app). Started by the deploy workflow before the apps update.
resource migrate 'Microsoft.App/jobs@2024-03-01' = {
  name: 'veqms-migrate'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${migrateIdentityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [ { server: registryServer, identity: migrateIdentityId } ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: apiImage
          command: [ 'node', '/app/with-pg-token.mjs', 'sh', '-c', 'node packages/db/dist/migrate.js && node /app/grant-app-role.mjs' ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'DATABASE_URL', value: migrateDatabaseUrl }
            { name: 'DATABASE_ENTRA_AUTH', value: '1' }
            { name: 'AZURE_CLIENT_ID', value: migrateIdentityClientId }
            { name: 'APP_DB_PRINCIPAL', value: appIdentityName }
          ]
        }
      ]
    }
  }
}

// Daily training reminders and overdue notices (06:00 UTC).
resource reminders 'Microsoft.App/jobs@2024-03-01' = {
  name: 'veqms-reminders'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${appIdentityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 900
      replicaRetryLimit: 1
      scheduleTriggerConfig: { cronExpression: '0 6 * * *', parallelism: 1, replicaCompletionCount: 1 }
      registries: [ { server: registryServer, identity: appIdentityId } ]
      secrets: apiSecrets
    }
    template: {
      containers: [
        {
          name: 'reminders'
          image: apiImage
          command: [ 'node', '/app/with-pg-token.mjs', 'node', 'apps/api/dist/jobs/reminders.js' ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: apiEnv
        }
      ]
    }
  }
}

// Audit anchors: the audit chain head written to the immutable records container (every 15 minutes by default, see
// auditAnchorCron), so the chain can't be rewritten unnoticed.
resource anchorJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'veqms-anchor'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${appIdentityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 300
      replicaRetryLimit: 1
      scheduleTriggerConfig: { cronExpression: auditAnchorCron, parallelism: 1, replicaCompletionCount: 1 }
      registries: [ { server: registryServer, identity: appIdentityId } ]
      secrets: apiSecrets
    }
    template: {
      containers: [
        {
          name: 'anchor'
          image: apiImage
          command: [ 'node', '/app/with-pg-token.mjs', 'node', 'apps/api/dist/jobs/anchor.js' ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: apiEnv
        }
      ]
    }
  }
}

// SharePoint: publish Effective versions still waiting, then the delta sync of the Drafts and controlled libraries
// (sharePointSyncCron, every 15 minutes by default). Changes made outside VeQMS raise integrity alerts.
resource sharePointJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'veqms-sharepoint'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${appIdentityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 600
      replicaRetryLimit: 1
      scheduleTriggerConfig: { cronExpression: sharePointSyncCron, parallelism: 1, replicaCompletionCount: 1 }
      registries: [ { server: registryServer, identity: appIdentityId } ]
      secrets: apiSecrets
    }
    template: {
      containers: [
        {
          name: 'sharepoint'
          image: apiImage
          command: [ 'node', '/app/with-pg-token.mjs', 'node', 'apps/api/dist/jobs/sharepoint.js' ]
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: apiEnv
        }
      ]
    }
  }
}

output apiFqdn string = api.properties.configuration.ingress.fqdn
output webFqdn string = web.properties.configuration.ingress.fqdn
