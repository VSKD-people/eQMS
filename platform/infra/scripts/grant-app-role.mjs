#!/usr/bin/env node
// Runs inside the migrate job, after the migrations, as the PostgreSQL Entra administrator (the migrate identity).
// Makes sure the API's managed identity has a database login and is a member of veqms_app (row-level security,
// no DELETE). Idempotent: safe on every deployment.
//
// CHECK BEFORE FIRST USE: pgaadauth_create_principal is Azure Database for PostgreSQL's function for creating a
// role mapped to an Entra principal. Confirm its name and arguments in Microsoft's current documentation
// ("Manage Microsoft Entra roles in Azure Database for PostgreSQL").
import pg from 'pg';

const principal = process.env.APP_DB_PRINCIPAL;
if (!principal) {
  console.log('APP_DB_PRINCIPAL not set: skipping the API database login step.');
  process.exit(0);
}
if (!/^[A-Za-z0-9_-]{1,63}$/.test(principal)) {
  console.error('APP_DB_PRINCIPAL must be a simple identity name (letters, digits, _ or -).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: 'veqms-grant' });
await client.connect();
try {
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [principal]);
  if (exists.rowCount === 0) {
    await client.query('select * from pgaadauth_create_principal($1, false, false)', [principal]);
    console.log(`created database login for ${principal}`);
  }
  // Identifiers can't be bound as parameters; the name was validated above.
  await client.query(`grant veqms_app to "${principal}"`);
  console.log(`${principal} is a member of veqms_app`);
} finally {
  await client.end();
}
