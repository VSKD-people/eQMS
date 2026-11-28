// Email and password sign-in (AUTH_MODE=local), for the pilot until Microsoft 365 sign-in is connected.
// Passwords are kept only as scrypt hashes (app.local_credentials). Five wrong passwords lock the account for 15
// minutes. A password set by an administrator is temporary: the person must change it before doing anything else.
// The API issues its own session token (HS256, 8 hours). Each token names the password it was issued under (the time
// it was set), so changing or resetting the password ends every earlier session; revoking sessions or a leaver's
// status ends them too.
// When Microsoft sign-in is connected, people keep their accounts: the first Microsoft sign-in links by email.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { maybe, one, withTenant, type Db, type Pool } from '@veqms/db';
import type { Config } from '../config.ts';
import { badRequest, conflict, HttpError } from '../lib/http.ts';
import { personByEmail, type Person } from '../lib/people.ts';
import { audit } from '../lib/work.ts';

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const TOKEN_HOURS = 8;
const COST = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LEN = 64;
const ISSUER = 'veqms-local', AUDIENCE = 'veqms-api';
const NOT_RECOGNISED = 'Email or password not recognised, or the account is locked. After 5 wrong passwords an account is locked for 15 minutes.';

function scrypt(password: string, salt: Buffer, len: number, o: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, len, o, (e, k) => (e ? reject(e) : resolve(k))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: COST.maxmem });
  return got.length === want.length && timingSafeEqual(got, want);
}

// The password rule: at least 12 characters, not built from the email address, not one character repeated.
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters. A short sentence is easier to remember than a jumble.';
  if (password.length > 200) return 'Use at most 200 characters.';
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 3 && password.toLowerCase().includes(local)) return 'Don’t use your email address in your password.';
  if (new Set(password).size < 4) return 'Use more than a few different characters.';
  return null;
}

function key(cfg: Config): Uint8Array { return new TextEncoder().encode(cfg.LOCAL_AUTH_SECRET); }

export async function issueToken(cfg: Config, userId: string, mustChange: boolean, passwordSetAt: Date): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_HOURS * 3600;
  const token = await new SignJWT({ pwv: new Date(passwordSetAt).getTime(), ...(mustChange ? { mc: true } : {}) }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(expiresAt).sign(key(cfg));
  return { token, expiresAt };
}

export async function readToken(cfg: Config, token: string): Promise<{ userId: string; iat: number; mustChange: boolean; passwordSetAt: number }> {
  try {
    const { payload } = await jwtVerify(token, key(cfg), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    if (!payload.sub || !payload.iat || typeof payload.pwv !== 'number') throw new Error('incomplete');
    return { userId: payload.sub, iat: payload.iat, mustChange: payload.mc === true, passwordSetAt: payload.pwv };
  } catch {
    throw new HttpError(401, 'Your sign-in has expired or isn’t valid. Sign in again.');
  }
}

// The tenant local sign-in belongs to (created by the bootstrap script under LOCAL_TENANT_KEY).
export async function localTenant(pool: Pool, cfg: Config): Promise<string> {
  const t = await withTenant(pool, { tenantId: '00000000-0000-0000-0000-000000000000', userId: null }, (db) =>
    maybe<{ tenant_id: string }>(db, 'select tenant_id from app.tenant_directory where entra_tenant_id = $1', [cfg.LOCAL_TENANT_KEY]));
  if (!t) throw new HttpError(503, 'VeQMS isn’t set up yet: run the bootstrap script to create the organisation and its first users.');
  return t.tenant_id;
}

type Cred = { password_hash: string; must_change: boolean; failed_count: number; locked_until: Date | null; changed_at: Date };
const CRED = 'select password_hash, must_change, failed_count, locked_until, changed_at from app.local_credentials where user_id = $1';

// The session still belongs to the current password (checked on every request).
export async function tokenStillValid(db: Db, userId: string, passwordSetAt: number): Promise<boolean> {
  const c = await maybe<{ changed_at: Date }>(db, 'select changed_at from app.local_credentials where user_id = $1', [userId]);
  return !!c && new Date(c.changed_at).getTime() === passwordSetAt;
}

// Every attempt is in the audit trail, in its own committed transaction, whatever the outcome.
export async function login(pool: Pool, cfg: Config, email: string, password: string, client: { ip: string | null; userAgent: string | null }) {
  const tenantId = await localTenant(pool, cfg);
  return withTenant(pool, { tenantId, userId: null, clientIp: client.ip, userAgent: client.userAgent }, async (db) => {
    const who = email.trim().toLowerCase();
    const u = await personByEmail(db, who);
    const c = u ? await maybe<Cred>(db, CRED, [u.id]) : null;
    const refuse = async (why: string) => { await audit(db, 'auth.failed', 'User', who, `Sign-in refused: ${why}`); return { ok: false as const, message: NOT_RECOGNISED }; };
    if (!u || !c) return refuse(u ? 'no password set for this account' : 'unknown email address');
    await db.query("select set_config('app.user_id', $1, true)", [u.id]);
    if (u.status !== 'active') return refuse(`access ${u.status === 'left' ? 'removed (leaver)' : 'revoked'}`);
    if (c.locked_until && new Date(c.locked_until).getTime() > Date.now()) return refuse(`account locked until ${new Date(c.locked_until).toISOString()}`);
    if (!(await verifyPassword(password, c.password_hash))) {
      const failed = c.failed_count + 1;
      if (failed >= MAX_FAILURES) {
        await db.query(`update app.local_credentials set failed_count = 0, locked_until = now() + make_interval(mins => $2) where user_id = $1`, [u.id, LOCK_MINUTES]);
        await audit(db, 'auth.locked', 'User', who, `Account locked for ${LOCK_MINUTES} minutes after ${failed} wrong passwords`);
        return { ok: false as const, message: NOT_RECOGNISED };
      }
      await db.query('update app.local_credentials set failed_count = $2 where user_id = $1', [u.id, failed]);
      return refuse(`wrong password (${failed} of ${MAX_FAILURES})`);
    }
    await db.query('update app.local_credentials set failed_count = 0, locked_until = null where user_id = $1', [u.id]);
    await audit(db, 'auth.login', 'User', who, `Signed in with email and password${c.must_change ? ' (temporary password: must change it now)' : ''}`);
    const t = await issueToken(cfg, u.id, c.must_change, c.changed_at);
    return { ok: true as const, ...t, mustChange: c.must_change, name: u.name, email: u.email };
  });
}

// The person changes their own password: the current one is checked again first.
export async function changePassword(db: Db, cfg: Config, me: Person, current: string, next: string) {
  const c = await maybe<Cred>(db, CRED, [me.id]);
  if (!c) throw conflict('Your account doesn’t use a VeQMS password.');
  if (!(await verifyPassword(current, c.password_hash))) throw badRequest('Your current password isn’t right.');
  const problem = passwordProblem(next, me.email);
  if (problem) throw badRequest(problem);
  if (await verifyPassword(next, c.password_hash)) throw badRequest('Choose a password different from the current one.');
  // Every other session ends (their tokens name the old password); this one continues with the new token.
  const set = await one<{ changed_at: Date }>(db, `update app.local_credentials set password_hash = $2, must_change = false, failed_count = 0, locked_until = null,
    changed_at = clock_timestamp() where user_id = $1 returning changed_at`, [me.id, await hashPassword(next)]);
  await audit(db, 'auth.password', 'User', me.email, c.must_change ? 'Replaced the temporary password' : 'Changed password');
  return issueToken(cfg, me.id, false, set.changed_at);
}

// A System Administrator sets a temporary password: for a new account, or to reset a forgotten one. It must be
// changed at the next sign-in, and any session the person has open ends.
export async function setTemporaryPassword(db: Db, admin: Person, user: Person, password: string, reason: string): Promise<void> {
  if (admin.id === user.id) throw badRequest('Change your own password from your account page.');
  const problem = passwordProblem(password, user.email);
  if (problem) throw badRequest(problem);
  const existed = !!(await maybe(db, 'select 1 from app.local_credentials where user_id = $1', [user.id]));
  // A new password time ends every session the person has open (their tokens name the old one).
  await db.query(`insert into app.local_credentials (user_id, tenant_id, password_hash, changed_at) values ($1, app.current_tenant(), $2, clock_timestamp())
    on conflict (user_id) do update set password_hash = excluded.password_hash, must_change = true, failed_count = 0, locked_until = null, changed_at = clock_timestamp()`,
    [user.id, await hashPassword(password)]);
  await audit(db, existed ? 'auth.reset' : 'auth.create', 'User', user.email, `${existed ? 'Reset the password of' : 'Set a first password for'} ${user.name} (temporary, to be changed at sign-in). Reason: ${reason}`);
}

export async function mustChange(db: Db, userId: string): Promise<boolean> {
  return !!(await maybe<{ must_change: boolean }>(db, 'select must_change from app.local_credentials where user_id = $1 and must_change', [userId]));
}

export async function credentialCount(db: Db): Promise<number> {
  return (await one<{ n: number }>(db, 'select count(*)::int as n from app.local_credentials')).n;
}
