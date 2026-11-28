// Email and password sign-in (AUTH_MODE=local) through the API with Fastify's request injection: refusals with one
// message for every cause, a temporary password that must be changed first, the password rule, lockout after five
// wrong passwords, an administrator's reset, sessions ending, leavers refused, and the audit trail of it all.
// Uses its own organisation (created here as the database owner), so it doesn't touch the demo tenant other tests use.
// Skipped without DATABASE_URL (a migrated database; the connection must be able to act as the owner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPool, withTenant, rows } from '@veqms/db';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import { createSharePoint } from '../src/integrations/sharepoint.ts';
import { hashPassword } from '../src/services/local-auth.ts';

test('email and password sign-in', { skip: process.env.DATABASE_URL ? false : 'set DATABASE_URL to a migrated database' }, async () => {
  const key = 'local-test-' + randomUUID();
  const owner = createPool({ connectionString: process.env.DATABASE_URL! });
  const ids: Record<string, string> = {};
  // Set up an organisation with an administrator (password already chosen) and a Quality Manager.
  const c = await owner.connect();
  try {
    await c.query('begin');
    await c.query('set local role veqms_owner');
    const t = (await c.query('insert into app.tenants (name) values ($1) returning id', ['Sign-in test'])).rows[0].id;
    await c.query("select set_config('app.tenant_id', $1, true)", [t]);
    ids.tenant = t;
    await c.query('insert into app.tenant_directory (entra_tenant_id, tenant_id) values ($1, $2)', [key, t]);
    await c.query('insert into app.settings (tenant_id) values ($1)', [t]);
    for (const [k, email, role] of [['admin', `admin-${t}@example.com`, 'admin'], ['qm', `qm-${t}@example.com`, 'qm']]) {
      ids[k] = (await c.query(`insert into app.users (tenant_id, email, name, initials) values ($1, $2, $3, 'X') returning id`, [t, email, k === 'admin' ? 'Ada Admin' : 'Quinn Quality'])).rows[0].id;
      ids[k + 'Email'] = email;
      await c.query('insert into app.user_roles (tenant_id, user_id, role) values ($1, $2, $3)', [t, ids[k], role]);
    }
    await c.query('insert into app.local_credentials (user_id, tenant_id, password_hash, must_change) values ($1, $2, $3, false)', [ids.admin, t, await hashPassword('admin password for the test')]);
    await c.query('commit');
  } finally { c.release(); }

  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('options', '-c role=veqms_app');
  const pool = createPool({ connectionString: url.toString() });
  const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), AUTH_MODE: 'local', LOCAL_AUTH_SECRET: 'test-secret-'.padEnd(48, 'x'), LOCAL_TENANT_KEY: key, SHAREPOINT_MODE: 'off', STORAGE_MODE: 'local' });
  const app = buildApp({ cfg, pool, esign: { mode: 'mock' } as any, storage: {} as any, sharepoint: createSharePoint(cfg) });
  let n = 0;
  const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); n++; };
  const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/auth/local/login', payload: { email, password } });
  const call = (token: string, method: 'GET' | 'POST', path: string, payload?: object) =>
    app.inject({ method, url: '/api/v1' + path, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  try {
    const unknown = await login('nobody@example.com', 'whatever whatever');
    const wrong = await login(ids.adminEmail!, 'not the password');
    ok(unknown.statusCode === 401 && wrong.statusCode === 401 && unknown.json().error.message === wrong.json().error.message, 'unknown email and wrong password get the same refusal');

    const a = await login(ids.adminEmail!.toUpperCase(), 'admin password for the test');
    ok(a.statusCode === 200 && a.json().mustChange === false, 'the administrator signs in (email in any case)');
    const admin = a.json().token as string;
    const me = (await call(admin, 'GET', '/me')).json();
    ok(me.authMode === 'local' && me.user.id === ids.admin, '/me says email and password sign-in');

    const email = `new-${ids.tenant}@example.com`;
    const weak = await call(admin, 'POST', '/users', { email, name: 'Nia New', roles: ['employee'], temporaryPassword: 'short' });
    ok(weak.statusCode === 400 && /12 characters/.test(weak.json().error.message), 'a temporary password follows the password rule');
    const made = await call(admin, 'POST', '/users', { email, name: 'Nia New', roles: ['employee'], temporaryPassword: 'temporary password 1' });
    ok(made.statusCode === 200, 'the administrator adds a person with a temporary password');
    ids.nia = made.json().id;
    ok((await call(admin, 'POST', '/users', { email, name: 'Nia Again', roles: ['employee'], temporaryPassword: 'temporary password 1' })).statusCode === 409, 'one account per email address');

    const first = await login(email, 'temporary password 1');
    ok(first.statusCode === 200 && first.json().mustChange === true, 'first sign-in with the temporary password: must change it');
    const temp = first.json().token as string;
    ok((await call(temp, 'GET', '/tasks')).statusCode === 403, 'nothing else works until it is changed');
    ok((await call(temp, 'GET', '/me')).json().mustChange === true, '/me says so');
    ok((await call(temp, 'POST', '/auth/password', { current: 'wrong one', next: 'a brand new password' })).statusCode === 400, 'the current password is checked');
    ok((await call(temp, 'POST', '/auth/password', { current: 'temporary password 1', next: 'temporary password 1' })).statusCode === 400, 'the new password must differ');
    const changed = await call(temp, 'POST', '/auth/password', { current: 'temporary password 1', next: 'nia chose this password' });
    ok(changed.statusCode === 200, 'the password is changed');
    const fresh = changed.json().token as string;
    ok((await call(fresh, 'GET', '/tasks')).statusCode === 200, 'the new session works');
    ok((await call(temp, 'GET', '/me')).statusCode === 401, 'the temporary session has ended');

    for (let i = 0; i < 5; i++) await login(email, 'guessing ' + i);
    ok((await login(email, 'nia chose this password')).statusCode === 401, 'locked after five wrong passwords, even with the right one');
    ok((await call(fresh, 'POST', `/users/${ids.admin}/password`, { temporaryPassword: 'x'.repeat(20), reason: 'trying' })).statusCode === 403, 'an employee can’t reset passwords');
    ok((await call(admin, 'POST', `/users/${ids.admin}/password`, { temporaryPassword: 'another admin password', reason: 'my own' })).statusCode === 400, 'an administrator can’t reset their own password here');
    ok((await call(admin, 'POST', `/users/${ids.nia}/password`, { temporaryPassword: 'reset password 22', reason: 'Locked out' })).statusCode === 200, 'the administrator resets it');
    ok((await call(fresh, 'GET', '/me')).statusCode === 401, 'the reset ends the person’s sessions');
    const again = await login(email, 'reset password 22');
    ok(again.statusCode === 200 && again.json().mustChange === true, 'the reset password works once, and must be changed');

    await call(admin, 'POST', `/users/${ids.nia}/revoke-sessions`);
    const left = await app.inject({ method: 'PUT', url: `/api/v1/users/${ids.nia}/status`, headers: { authorization: `Bearer ${admin}` }, payload: { status: 'left', reason: 'Left the company' } });
    ok(left.statusCode === 200 && (await login(email, 'reset password 22')).statusCode === 401, 'a leaver can’t sign in');

    const log = await withTenant(pool, { tenantId: ids.tenant!, userId: null }, (db) => rows<{ action: string }>(db, `select action from app.audit_log where action like 'auth.%' order by seq`));
    const count = (x: string) => log.filter((l) => l.action === x).length;
    ok(count('auth.failed') >= 5 && count('auth.locked') === 1 && count('auth.login') >= 3 && count('auth.password') === 1 && count('auth.create') === 1 && count('auth.reset') === 1,
      `every attempt is audited (${log.length} sign-in entries)`);
    const chain = await withTenant(pool, { tenantId: ids.tenant!, userId: null }, (db) => db.query('select * from app.verify_audit_chain()'));
    ok(chain.rows[0].ok === true, 'the audit chain verifies');

    const entra = buildApp({ cfg: loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString() }), pool, esign: { mode: 'mock' } as any, storage: {} as any, sharepoint: createSharePoint(cfg) });
    ok((await entra.inject({ method: 'POST', url: '/auth/local/login', payload: { email, password: 'x' } })).statusCode === 404, 'with Microsoft sign-in, the password route doesn’t exist');
    await entra.close();
    ok((await call(admin.slice(0, -4) + 'abcd', 'GET', '/me')).statusCode === 401, 'a tampered token is refused');
    console.log(`  ✓ email and password sign-in: ${n} checks`);
  } finally {
    await app.close();
    await pool.end();
    await owner.end();
  }
});
