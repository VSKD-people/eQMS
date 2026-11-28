// Creates (or updates) the API's database login with a password, as a member of veqms_app: row-level security
// applies and it can never DELETE. For hosts with password logins (a container host's managed PostgreSQL); Azure uses
// the API's managed identity instead (infra/scripts/grant-app-role.mjs). Run after the migrations, as the owner:
//
//   DATABASE_URL=<owner connection> APP_DB_USER=veqms_api APP_DB_PASSWORD=<long random> node packages/db/dist/provision.js
//
// The owner connection needs permission to create roles (CREATEROLE). Check that your PostgreSQL provider allows it.
import pg from 'pg';

const url = process.env.DATABASE_URL;
const user = process.env.APP_DB_USER || 'veqms_api';
const password = process.env.APP_DB_PASSWORD ?? '';
if (!url) { console.error('Set DATABASE_URL to the database owner\'s connection.'); process.exit(1); }
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(user)) { console.error('APP_DB_USER must be lower-case letters, digits or _.'); process.exit(1); }
if (password.length < 24) { console.error('APP_DB_PASSWORD must be at least 24 random characters.'); process.exit(1); }

const client = new pg.Client({ connectionString: url, application_name: 'veqms-provision', ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: true } : undefined });
await client.connect();
try {
  // Role names and passwords can't be bound as parameters: the name was checked above, the password is escaped.
  const lit = client.escapeLiteral(password);
  const exists = await client.query('select 1 from pg_roles where rolname = $1', [user]);
  if (exists.rowCount) {
    await client.query(`alter role "${user}" with login password ${lit}`);
    console.log(`updated the password of ${user}`);
  } else {
    await client.query(`create role "${user}" with login password ${lit}`);
    console.log(`created database login ${user}`);
  }
  await client.query(`grant veqms_app to "${user}"`);
  console.log(`${user} is a member of veqms_app (row-level security applies; it can't delete)`);
} finally {
  await client.end();
}
