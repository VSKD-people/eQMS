// Virtual network: one subnet for the Container Apps environment (workload profiles, delegated to
// Microsoft.App/environments) and one delegated to PostgreSQL Flexible Server, plus the private DNS zone
// the database resolves through. NOT VALIDATED: check with `az bicep build` and what-if before first use.

param location string
param namePrefix string
param tags object

@description('Address space. Change it if it overlaps an existing network you will peer with.')
param addressPrefix string = '10.20.0.0/16'
param appsSubnetPrefix string = '10.20.0.0/23'
param postgresSubnetPrefix string = '10.20.4.0/24'

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: 'vnet-${namePrefix}'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: [ addressPrefix ] }
    subnets: [
      {
        name: 'snet-apps'
        properties: {
          addressPrefix: appsSubnetPrefix
          delegations: [
            { name: 'apps', properties: { serviceName: 'Microsoft.App/environments' } }
          ]
          // Lets the storage account firewall allow this subnet. Check service endpoints are supported on a
          // subnet delegated to Microsoft.App/environments; if not, use a private endpoint for blob storage.
          serviceEndpoints: [
            { service: 'Microsoft.Storage' }
          ]
        }
      }
      {
        name: 'snet-postgres'
        properties: {
          addressPrefix: postgresSubnetPrefix
          delegations: [
            { name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }
          ]
        }
      }
    ]
  }
}

// The zone name must end with .postgres.database.azure.com
resource postgresDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: '${namePrefix}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}
resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: postgresDns
  name: 'link-${namePrefix}'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

output vnetId string = vnet.id
output appsSubnetId string = vnet.properties.subnets[0].id
output postgresSubnetId string = vnet.properties.subnets[1].id
output postgresDnsZoneId string = postgresDns.id
