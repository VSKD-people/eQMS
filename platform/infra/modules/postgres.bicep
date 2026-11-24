// Azure Database for PostgreSQL Flexible Server 16: private (VNet-integrated), Entra ID authentication only,
// 35-day backups geo-replicated to the paired region (UK South → UK West), database `veqms`.
// NOT VALIDATED: confirm the API version accepts version '16', and the property names, with `az bicep build`
// and what-if. Geo-redundant backup can only be chosen when the server is created.

param location string
param serverName string
param tags object
param tenantId string
param delegatedSubnetId string
param privateDnsZoneId string
param skuName string
param skuTier string
param highAvailability string
param storageGb int
param migrateIdentityPrincipalId string
param migrateIdentityName string
param adminGroupObjectId string = ''
param adminGroupName string = ''

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: '16'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenantId
    }
    storage: {
      storageSizeGB: storageGb
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 35
      geoRedundantBackup: 'Enabled'
    }
    network: {
      delegatedSubnetResourceId: delegatedSubnetId
      privateDnsZoneArmResourceId: privateDnsZoneId
      publicNetworkAccess: 'Disabled'
    }
    highAvailability: {
      mode: highAvailability
    }
  }
}

// The migration job's identity is the Entra administrator: it creates roles, runs migrations and grants
// veqms_app to the API identity. The API identity is never an administrator.
resource migrateAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: server
  name: migrateIdentityPrincipalId
  properties: {
    principalType: 'ServicePrincipal'
    principalName: migrateIdentityName
    tenantId: tenantId
  }
}

// Optional: a group of people who can administer the server (break-glass, restore drills).
resource groupAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = if (!empty(adminGroupObjectId)) {
  parent: server
  name: empty(adminGroupObjectId) ? 'unused' : adminGroupObjectId
  properties: {
    principalType: 'Group'
    principalName: adminGroupName
    tenantId: tenantId
  }
  dependsOn: [ migrateAdmin ]
}

// Changes to one flexible server are serialised to avoid "server busy" conflicts.
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: 'veqms'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
  dependsOn: [ migrateAdmin, groupAdmin ]
}

// Azure only allows extensions that are on this list. The schema needs pgcrypto (SHA-256 for the audit chain).
resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'azure.extensions'
  properties: {
    value: 'PGCRYPTO'
    source: 'user-override'
  }
  dependsOn: [ database ]
}

// Encrypted connections only.
resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
  dependsOn: [ extensions ]
}

output fqdn string = server.properties.fullyQualifiedDomainName
output serverId string = server.id
