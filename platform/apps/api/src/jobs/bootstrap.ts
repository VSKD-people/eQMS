// Creates the organisation and its first two accounts, for email and password sign-in (AUTH_MODE=local). Run once,
// after the migrations, with the database OWNER's connection (not the API's):
//
//   DATABASE_URL=<owner connection> node apps/api/dist/jobs/bootstrap.js \
//     --org "Organisation name" \
//     --admin-email admin@example.com --admin-name "First System Administrator" \
//     --qm-email quality@example.com --qm-name "First Quality Manager"
//
// Optional: --groups "All staff,IT team,Managers" (training audiences; default "All staff"), --no-simulated-signatures
// (refuse simulated signatures from the start), and ADMIN_PASSWORD / QM_PASSWORD in the environment. Without them, a
// temporary password is generated for each account and printed once: give it to the person directly. Both must
// change it at their first sign-in. Then the System Administrator adds everyone else in Administration → Users.
//
// The System Administrator and the Quality Manager are two people: an administrator can't also approve (segregation
// of duties). It refuses to run twice for the same LOCAL_TENANT_KEY.
import { randomBytes } from 'node:crypto';
import { createPool } from '@veqms/db';
import { hashPassword, passwordProblem } from '../services/local-auth.ts';

const TEMPLATES: [string, string, string, string[]][] = [
  ['TPL-POL', 'Policy', 'Policy', ['1. Purpose', '2. Scope', '3. Policy statements', '4. Roles and responsibilities', '5. Exceptions', '6. Review']],
  ['TPL-SOP', 'Procedure (SOP)', 'Procedure', ['1. Purpose', '2. Scope', '3. Roles', '4. Procedure', '5. Records', '6. Related documents']],
  ['TPL-WI', 'Work instruction', 'Work instruction', ['1. Purpose', '2. Before you start', '3. Steps', '4. Records']],
  ['TPL-VP', 'Validation plan', 'Validation plan', ['1. System and scope', '2. Approach and risk', '3. Deliverables', '4. Acceptance criteria', '5. Roles']],
  ['TPL-VR', 'Validation report', 'Validation report', ['1. System and scope', '2. Results', '3. Deviations', '4. Conclusion']],
  ['TPL-VEN', 'Vendor approval', 'Vendor approval', ['1. Vendor and service', '2. Assessment', '3. Risks and conditions', '4. Decision']],
  ['TPL-UAR', 'User access review', 'User access review', ['1. System and period', '2. Accounts reviewed', '3. Findings and changes made', '4. Decision']],
  ['TPL-RA', 'Risk assessment', 'Risk assessment', ['1. Scope', '2. Risks identified', '3. Likelihood and impact', '4. Treatment', '5. Residual risk and decision']]
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function need(name: string): string {
  const v = arg(name)?.trim();
  if (!v) throw new Error(`Missing --${name}. See the top of jobs/bootstrap.ts for the command.`);
  return v;
}
const initials = (name: string) => name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3).toUpperCase();
// 18 random bytes as base64url: 24 characters, meets the password rule.
const generated = () => randomBytes(18).toString('base64url');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL to the database owner\'s connection.');
  const key = process.env.LOCAL_TENANT_KEY || 'local';
  const org = need('org');
  const people = [
    { role: 'admin', email: need('admin-email').toLowerCase(), name: need('admin-name'), password: process.env.ADMIN_PASSWORD, clearance: 'Internal', title: 'System Administrator' },
    { role: 'qm', email: need('qm-email').toLowerCase(), name: need('qm-name'), password: process.env.QM_PASSWORD, clearance: 'Restricted', title: 'Quality Manager' }
  ];
  if (people[0]!.email === people[1]!.email) throw new Error('The System Administrator and the Quality Manager must be two different people.');
  for (const p of people) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) throw new Error(`${p.email} isn't an email address.`);
    const problem = p.password ? passwordProblem(p.password, p.email) : null;
    if (problem) throw new Error(`Password for ${p.email}: ${problem}`);
  }
  const groups = (arg('groups') ?? 'All staff').split(',').map((g) => g.trim()).filter(Boolean);
  const allowSimulated = !process.argv.includes('--no-simulated-signatures');

  const pool = createPool({ connectionString: url, max: 1, ssl: process.env.DATABASE_SSL === '1' });
  const client = await pool.connect();
  const printed: string[] = [];
  try {
    await client.query('begin');
    await client.query('set local role veqms_owner');
    const exists = await client.query('select tenant_id from app.tenant_directory where entra_tenant_id = $1', [key]);
    if (exists.rowCount) throw new Error(`An organisation is already set up for sign-in key "${key}". Nothing changed.`);
    const t = (await client.query<{ id: string }>('insert into app.tenants (name) values ($1) returning id', [org])).rows[0]!.id;
    await client.query("select set_config('app.tenant_id', $1, true)", [t]);
    await client.query('insert into app.tenant_directory (entra_tenant_id, tenant_id) values ($1, $2)', [key, t]);
    await client.query('insert into app.settings (tenant_id, allow_simulated_signatures) values ($1, $2)', [t, allowSimulated]);
    const groupIds: string[] = [];
    for (const g of groups) groupIds.push((await client.query<{ id: string }>('insert into app.groups (tenant_id, name) values ($1, $2) returning id', [t, g])).rows[0]!.id);
    for (const [code, name, docType, sections] of TEMPLATES) {
      await client.query(`insert into app.templates (tenant_id, code, name, kind, doc_type, version, state, sections) values ($1, $2, $3, 'Document', $4, '1.0', 'Effective', $5)`, [t, code, name, docType, sections]);
    }
    for (const p of people) {
      const u = (await client.query<{ id: string }>(`insert into app.users (tenant_id, email, name, initials, job_title, clearance) values ($1, $2, $3, $4, $5, $6) returning id`,
        [t, p.email, p.name, initials(p.name), p.title, p.clearance])).rows[0]!.id;
      await client.query('insert into app.user_roles (tenant_id, user_id, role) values ($1, $2, $3)', [t, u, p.role]);
      if (groupIds[0]) await client.query('insert into app.group_members (tenant_id, group_id, user_id) values ($1, $2, $3)', [t, groupIds[0], u]);
      const password = p.password ?? generated();
      await client.query('insert into app.local_credentials (user_id, tenant_id, password_hash) values ($1, $2, $3)', [u, t, await hashPassword(password)]);
      if (!p.password) printed.push(`  ${p.title}: ${p.email}  temporary password: ${password}`);
    }
    await client.query(`select app.audit('bootstrap', 'Tenant', $1, $2)`, [t,
      `Set up ${org} for email and password sign-in: ${people.map((p) => `${p.name} (${p.title})`).join(' and ')}; groups ${groups.join(', ')}; ${TEMPLATES.length} document templates; simulated signatures ${allowSimulated ? 'allowed (pilot)' : 'refused'}`]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`Set up "${org}" (sign-in key "${key}").`);
  if (printed.length) {
    console.log('Give each person their temporary password directly; they must change it at their first sign-in:');
    for (const line of printed) console.log(line);
    console.log('These passwords are not stored anywhere else. Clear this output from any log you keep.');
  }
}

main().catch((e) => { console.error(String((e as Error)?.message ?? e)); process.exit(1); });
