// Sign-in: validates the Microsoft Entra ID access token on every request, maps it to a tenant and a VeQMS user,
// and refuses revoked or departed users. Development builds can use X-Dev-User instead (never in production).
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { maybe, withTenant, type Pool } from '@veqms/db';
import type { Config } from '../config.ts';
import { HttpError } from './http.ts';
import { personByEmail, personByOid, type Person } from './people.ts';

export interface Auth {
  tenantId: string;
  tenantName: string;
  user: Person;
  via: 'Microsoft 365 single sign-on' | 'Development sign-in';
}

const authOf = new WeakMap<object, Auth>();
export function getAuth(req: object): Auth {
  const a = authOf.get(req);
  if (!a) throw new HttpError(401, 'Sign in first.');
  return a;
}
export function setAuth(req: object, a: Auth): void { authOf.set(req, a); }

export function createAuthenticator(cfg: Config, pool: Pool) {
  const jwks = cfg.ENTRA_TENANT_ID ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/discovery/v2.0/keys`)) : null;

  async function resolve(tid: string, find: (tenantId: string) => Promise<Person | null>, via: Auth['via'], iat?: number): Promise<Auth> {
    const t = await withTenant(pool, { tenantId: '00000000-0000-0000-0000-000000000000', userId: null }, (db) =>
      maybe<{ tenant_id: string }>(db, 'select tenant_id from app.tenant_directory where entra_tenant_id = $1', [tid]));
    if (!t) throw new HttpError(403, 'Your organisation isn’t set up in VeQMS.');
    const found = await withTenant(pool, { tenantId: t.tenant_id, userId: null }, async (db) => {
      const user = await find(t.tenant_id);
      const name = await maybe<{ name: string }>(db, 'select name from app.tenants where id = $1', [t.tenant_id]);
      return { user, tenantName: name?.name ?? '' };
    });
    const user = found.user;
    if (!user) throw new HttpError(403, 'Your account isn’t set up in VeQMS yet. Ask a System Administrator.');
    if (user.status !== 'active') throw new HttpError(403, 'Your access has been removed.');
    if (iat && user.sessionsRevokedAt && iat * 1000 < new Date(user.sessionsRevokedAt).getTime()) throw new HttpError(401, 'Your session was ended. Sign in again.');
    return { tenantId: t.tenant_id, tenantName: found.tenantName, user, via };
  }

  return async function authenticate(headers: Record<string, string | string[] | undefined>): Promise<Auth> {
    const dev = headers['x-dev-user'];
    if (typeof dev === 'string' && dev) {
      if (!cfg.devAuthAllowed) throw new HttpError(401, 'Development sign-in is switched off.');
      return resolve('dev-tenant', (tenantId) => withTenant(pool, { tenantId, userId: null }, (db) => personByOid(db, dev)), 'Development sign-in');
    }
    const h = headers.authorization;
    const token = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token || !jwks) throw new HttpError(401, 'Sign in first.');
    let payload: JWTPayload & { oid?: string; tid?: string; scp?: string; preferred_username?: string; email?: string };
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer: `https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/v2.0`, audience: cfg.ENTRA_API_AUDIENCE }));
    } catch {
      throw new HttpError(401, 'Your sign-in has expired or isn’t valid. Sign in again.');
    }
    if (!payload.oid || !payload.tid) throw new HttpError(401, 'The sign-in token is missing the user or tenant.');
    if (!String(payload.scp ?? '').split(' ').includes('access_as_user')) throw new HttpError(403, 'The sign-in token doesn’t grant access to VeQMS.');
    const oid = payload.oid, email = payload.preferred_username ?? payload.email ?? '';
    return resolve(payload.tid, (tenantId) => withTenant(pool, { tenantId, userId: null }, async (db) => {
      const byOid = await personByOid(db, oid);
      if (byOid) return byOid;
      // First sign-in of a user provisioned by SCIM: bind the Entra object id once, by email.
      const byEmail = email ? await personByEmail(db, email) : null;
      if (byEmail && !byEmail.entraOid) {
        await db.query('update app.users set entra_oid = $1 where id = $2', [oid, byEmail.id]);
        return { ...byEmail, entraOid: oid };
      }
      return null;
    }), 'Microsoft 365 single sign-on', payload.iat);
  };
}
