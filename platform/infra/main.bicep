// VeQMS Phase 1 infrastructure: Azure UK South.
//
// NOT VALIDATED: there was no Bicep CLI or Azure subscription where this was written. Before the first
// deployment, run `az bicep build --file infra/main.bicep` and
// `az deployment group what-if --resource-group <rg> --template-file infra/main.bicep --parameters @infra/main.parameters.json`,
// and check every resource API version and property against Microsoft's current Bicep reference. In particular:
// PostgreSQL Flexible Server API version and version '16', Container Apps workload-profile networking, the storage
// immutability policy, and service endpoints on a delegated subnet.
//
// Two-phase deployment (see docs/05-deployment-azure.md):
//   1. deployApps = false: network, identities, Key Vault, registry, storage, PostgreSQL, logs.
//   2. Add the Key Vault secrets and run the database steps, then deploy again with deployApps = true.
// Container apps that reference Key Vault secrets fail to start if the secrets don't exist yet.

targetScope = 'resourceGroup'

@description('Azure region. The specs settle on UK South, with backups geo-replicated to the paired region (UK West).')
param location string = 'uksouth'

@description('Short prefix used in resource names.')
@maxLength(8)
param namePrefix string = 'veqms'

@description('Deploy the container apps and jobs (phase 2). Leave false for the first run.')
param deployApps bool = false

@description('Entra ID tenant (directory) ID.')
param entraTenantId string = tenant().tenantId

@description('API app registration: Application ID URI or client ID that access tokens are issued for.')
param entraApiAudience string = ''

@description('Web app registration client ID (confidential client).')
param entraWebClientId string = ''

@description('Scope the web app asks for, e.g. api://<api-client-id>/access_as_user')
param entraApiScope string = ''

@description('Object ID of an Entra group whose members administer PostgreSQL (in addition to the migration identity).')
param postgresAdminGroupObjectId string = ''

@description('Display name of that Entra group.')
param postgresAdminGroupName string = ''

@description('PostgreSQL compute size.')
param postgresSkuName string = 'Standard_D2ds_v5'

@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param postgresSkuTier string = 'GeneralPurpose'

@description('ZoneRedundant needs a supported SKU and costs more. Agree with the business before switching on.')
@allowed(['Disabled', 'ZoneRedundant', 'SameZone'])
param postgresHighAvailability string = 'Disabled'

param postgresStorageGb int = 128

@description('Days that signed PDFs and certificates of completion cannot be changed or deleted. Placeholder: no retention schedule is agreed yet (the prototype sample data uses "life of the system + 10 years" for signatures, which is not a decision). Set this from the agreed schedule.')
param recordsImmutabilityDays int = 3650

@description('Container image for the API, migrate and reminders jobs. The placeholder lets phase 2 deploy before the first build.')
param apiImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Container image for the web app.')
param webImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Public address of the web app, e.g. https://qms.example.co.uk. Empty = the Container Apps default address.')
param appBaseUrl string = ''

@allowed(['mock', 'live'])
@description('Keep mock until the DocuSign account, JWT grant and Connect are set up.')
param docusignMode string = 'mock'

@description('account-d.docusign.com (demo) or account.docusign.com (production)')
param docusignAuthServer string = 'account-d.docusign.com'

@description('e.g. https://demo.docusign.net for the demo environment; production comes from the userinfo call')
param docusignBaseUri string = 'https://demo.docusign.net'

param docusignIntegrationKey string = ''
param docusignUserId string = ''
param docusignAccountId string = ''

@description('Give the API its own public HTTPS address, so DocuSign Connect and Entra SCIM provisioning can reach /webhooks/docusign and /scim/v2. Leave false only if the web app proxies those paths.')
param apiExternal bool = false

@description('Shared QMS mailbox for email notifications. Empty = in-app notifications only.')
param graphMailFrom string = ''

param tags object = {
  system: 'VeQMS'
  environment: 'production'
  dataResidency: 'UK'
}

var suffix = take(uniqueString(resourceGroup().id), 8)
var names = {
  logs: 'log-${namePrefix}-${suffix}'
  appIdentity: 'id-${namePrefix}-app'
  webIdentity: 'id-${namePrefix}-web'
  migrateIdentity: 'id-${namePrefix}-migrate'
  keyVault: 'kv-${namePrefix}-${suffix}'
  registry: '${namePrefix}acr${suffix}'
  storage: 'st${namePrefix}${suffix}'
  postgres: 'psql-${namePrefix}-${suffix}'
  environment: 'cae-${namePrefix}-${suffix}'
}

// Built-in role definition IDs
var roles = {
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
}

// ---------- Logs ----------
resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: names.logs
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 90
  }
}

// ---------- Identities: least privilege, one per job ----------
// app: the API and the reminders job (database as veqms_app, blob storage, Key Vault secrets)
// web: the Next.js app (Key Vault secrets only; no database access)
// migrate: PostgreSQL Entra administrator, used only by the migration job
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.appIdentity
  location: location
  tags: tags
}
resource webIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.webIdentity
  location: location
  tags: tags
}
resource migrateIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.migrateIdentity
  location: location
  tags: tags
}

// ---------- Network ----------
module network 'modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    namePrefix: namePrefix
    tags: tags
  }
}

// ---------- Key Vault (RBAC mode). Secrets are added by hand: names are listed in docs/05-deployment-azure.md ----------
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.keyVault
  location: location
  tags: tags
  properties: {
    tenantId: entraTenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled' // tighten to private access once operators have a route in
  }
}
resource kvAppReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appIdentity.id, roles.keyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource kvWebReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webIdentity.id, roles.keyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- Container registry ----------
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: names.registry
  location: location
  tags: tags
  sku: { name: 'Standard' }
  properties: {
    adminUserEnabled: false
  }
}
resource acrPullApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, appIdentity.id, roles.acrPull)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource acrPullWeb 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, webIdentity.id, roles.acrPull)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
    principalId: webIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource acrPullMigrate 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, migrateIdentity.id, roles.acrPull)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
    principalId: migrateIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- Storage: PDFs, signed PDFs and certificates of completion ----------
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: names.storage
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_ZRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // managed identity only
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      virtualNetworkRules: [
        { id: network.outputs.appsSubnetId, action: 'Allow' }
      ]
    }
  }
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: 30 }
    containerDeleteRetentionPolicy: { enabled: true, days: 30 }
  }
}
resource recordsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'records'
  properties: {
    publicAccess: 'None'
  }
}
// Time-based retention (WORM). Left UNLOCKED on purpose: locking is irreversible. Lock it only after the
// retention period is agreed and validation is complete. Check whether version-level immutability or a legal
// hold suits the records retention schedule better before go-live.
resource recordsImmutability 'Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies@2023-01-01' = {
  parent: recordsContainer
  name: 'default'
  properties: {
    immutabilityPeriodSinceCreationInDays: recordsImmutabilityDays
    allowProtectedAppendWrites: false
  }
}
resource storageAppWriter 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, appIdentity.id, roles.storageBlobDataContributor)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.storageBlobDataContributor)
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------- PostgreSQL ----------
module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    serverName: names.postgres
    tags: tags
    tenantId: entraTenantId
    delegatedSubnetId: network.outputs.postgresSubnetId
    privateDnsZoneId: network.outputs.postgresDnsZoneId
    skuName: postgresSkuName
    skuTier: postgresSkuTier
    highAvailability: postgresHighAvailability
    storageGb: postgresStorageGb
    migrateIdentityPrincipalId: migrateIdentity.properties.principalId
    migrateIdentityName: migrateIdentity.name
    adminGroupObjectId: postgresAdminGroupObjectId
    adminGroupName: postgresAdminGroupName
  }
}

// ---------- Container Apps environment, apps and jobs ----------
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: names.environment
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: network.outputs.appsSubnetId
      internal: false
    }
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
    zoneRedundant: false
  }
}

var webFqdn = 'veqms-web.${environment.properties.defaultDomain}'
var apiInternalFqdn = apiExternal ? 'veqms-api.${environment.properties.defaultDomain}' : 'veqms-api.internal.${environment.properties.defaultDomain}'
var baseUrl = empty(appBaseUrl) ? 'https://${webFqdn}' : appBaseUrl

module apps 'modules/apps.bicep' = if (deployApps) {
  name: 'apps'
  params: {
    location: location
    tags: tags
    environmentId: environment.id
    registryServer: registry.properties.loginServer
    keyVaultUri: keyVault.properties.vaultUri
    appIdentityId: appIdentity.id
    appIdentityClientId: appIdentity.properties.clientId
    appIdentityName: appIdentity.name
    webIdentityId: webIdentity.id
    migrateIdentityId: migrateIdentity.id
    migrateIdentityClientId: migrateIdentity.properties.clientId
    migrateIdentityName: migrateIdentity.name
    postgresFqdn: postgres.outputs.fqdn
    storageAccountUrl: storage.properties.primaryEndpoints.blob
    apiImage: apiImage
    webImage: webImage
    appBaseUrl: baseUrl
    apiInternalUrl: 'https://${apiInternalFqdn}'
    entraTenantId: entraTenantId
    entraApiAudience: entraApiAudience
    entraWebClientId: entraWebClientId
    entraApiScope: entraApiScope
    docusignMode: docusignMode
    docusignAuthServer: docusignAuthServer
    docusignBaseUri: docusignBaseUri
    docusignIntegrationKey: docusignIntegrationKey
    docusignUserId: docusignUserId
    docusignAccountId: docusignAccountId
    graphMailFrom: graphMailFrom
    apiExternal: apiExternal
  }
  dependsOn: [
    kvAppReader
    kvWebReader
    acrPullApp
    acrPullWeb
    acrPullMigrate
    storageAppWriter
  ]
}

output registryLoginServer string = registry.properties.loginServer
output registryName string = registry.name
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output postgresServerName string = names.postgres
output postgresFqdn string = postgres.outputs.fqdn
output storageAccountName string = storage.name
output appIdentityName string = appIdentity.name
output appIdentityClientId string = appIdentity.properties.clientId
output migrateIdentityName string = migrateIdentity.name
output webIdentityName string = webIdentity.name
output environmentName string = environment.name
output webUrl string = baseUrl
output apiInternalUrl string = 'https://${apiInternalFqdn}'
