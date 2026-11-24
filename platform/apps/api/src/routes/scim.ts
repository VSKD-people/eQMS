// SCIM 2.0 for Microsoft Entra ID user provisioning: users, groups and group membership. New starters, group changes
// and leavers reconcile training at once. Roles are not provisioned: a System Administrator grants them in VeQMS.
// Run Microsoft's SCIM validator against this endpoint before go-live; Entra's exact PATCH shapes vary.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { mapSeq, maybe, one, rows, withTenant, type Db } from '@veqms/db';
import type { Ctx } from '../app.ts';
import { HttpError, toHttp } from '../lib/http.ts';
import { people, type Person } from '../lib/people.ts';
import { audit } from '../lib/work.ts';
import { reconcileUser } from '../services/training.ts';
import { setStatus } from './admin.ts';

const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERR = 'urn:ietf:params:scim:api:messages:2.0:Error';

type Op = { op: string; path?: string; value?: unknown };
type ScimUser = { userName?: string; externalId?: string; displayName?: string; title?: string; active?: boolean | string; name?: { formatted?: string; givenName?: string; familyName?: string }; emails?: { value: string; primary?: boolean }[] };

const truthy = (v: unknown) => !(v === false || String(v).toLowerCase() === 'false');
const userRes = (p: Person, ext: string | null) => ({ schemas: [USER], id: p.id, externalId: ext ?? undefined, userName: p.email, displayName: p.name, name: { formatted: p.name }, title: p.jobTitle ?? undefined,
  active: p.status === 'active', emails: [{ value: p.email, primary: true, type: 'work' }], meta: { resourceType: 'User' } });

function scimError(reply: FastifyReply, status: number, detail: string) {
  return reply.code(status).type('application/scim+json').send({ schemas: [ERR], status: String(status), detail });
}
function eqFilter(filter: unknown, attr: string): string | null {
  if (typeof filter !== 'string') return null;
  const m = filter.match(new RegExp(`^${attr}\\s+eq\\s+"([^"]*)"$`, 'i'));
  return m ? m[1]! : null;
}
async function user(db: Db, id: string): Promise<{ p: Person; ext: string | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await people(db, [id]);
  if (!p) return null;
  const r = await one<{ scim_external_id: string | null }>(db, 'select scim_external_id from app.users where id = $1', [id]);
  return { p, ext: r.scim_external_id };
}
async function groupRes(db: Db, g: { id: string; name: string; entra_group_id: string | null }) {
  const m = await rows<{ user_id: string; name: string }>(db, 'select m.user_id, u.name from app.group_members m join app.users u on u.id = m.user_id where m.group_id = $1', [g.id]);
  return { schemas: [GROUP], id: g.id, externalId: g.entra_group_id ?? undefined, displayName: g.name, members: m.map((x) => ({ value: x.user_id, display: x.name })), meta: { resourceType: 'Group' } };
}

export function scimRoutes(scim: FastifyInstance, ctx: Ctx): void {
  scim.addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_req, text, done) => {
    try { done(null, JSON.parse(String(text))); } catch (e) { done(e as Error, undefined); }
  });
  scim.addHook('onRequest', async (req) => {
    const h = req.headers.authorization;
    const given = Buffer.from(typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : '');
    const want = Buffer.from(ctx.cfg.SCIM_TOKEN);
    if (!want.length || given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(401, 'SCIM token refused.');
  });
  // Fastify 5 types the error as unknown (anything can be thrown); toHttp maps it the same way as the main API.
  scim.setErrorHandler((err, req, reply) => {
    const h = toHttp(err);
    if (h.status >= 500) req.log.error({ err }, 'SCIM request failed');
    void scimError(reply, h.status, h.body.error.message);
  });

  // One deployment serves the tenant named by ENTRA_TENANT_ID.
  const tx = async <T>(fn: (db: Db) => Promise<T>): Promise<T> => {
    const t = await ctx.pool.query<{ tenant_id: string }>('select tenant_id from app.tenant_directory where entra_tenant_id = $1', [ctx.cfg.ENTRA_TENANT_ID || 'dev-tenant']);
    if (!t.rows[0]) throw new HttpError(500, 'Tenant not configured');
    return withTenant(ctx.pool, { tenantId: t.rows[0].tenant_id, userId: null }, fn);
  };
  const send = (reply: FastifyReply, status: number, body: unknown) => reply.code(status).type('application/scim+json').send(body);

  // ---------- Users ----------
  scim.get('/Users', async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const out = await tx(async (db) => {
      const email = eqFilter(q.filter, 'userName'), ext = eqFilter(q.filter, 'externalId');
      const ids = (await rows<{ id: string; scim_external_id: string | null }>(db, `select id, scim_external_id from app.users where ($1::text is null or lower(email) = lower($1)) and ($2::text is null or scim_external_id = $2) order by name`, [email, ext]));
      const ps = await people(db, ids.map((r) => r.id));
      return ps.map((p) => userRes(p, ids.find((r) => r.id === p.id)?.scim_external_id ?? null));
    });
    return send(reply, 200, { schemas: [LIST], totalResults: out.length, startIndex: 1, itemsPerPage: out.length, Resources: out });
  });

  scim.get('/Users/:id', async (req, reply) => {
    const r = await tx((db) => user(db, (req.params as { id: string }).id));
    return r ? send(reply, 200, userRes(r.p, r.ext)) : scimError(reply, 404, 'User not found');
  });

  scim.post('/Users', async (req, reply) => {
    const b = (req.body ?? {}) as ScimUser;
    const email = (b.userName ?? b.emails?.find((e) => e.primary)?.value ?? b.emails?.[0]?.value ?? '').toLowerCase();
    const name = b.displayName ?? b.name?.formatted ?? [b.name?.givenName, b.name?.familyName].filter(Boolean).join(' ');
    if (!email || !name) return scimError(reply, 400, 'userName and displayName are required');
    const res = await tx(async (db) => {
      if (await maybe(db, 'select 1 from app.users where lower(email) = $1', [email])) return null;
      const initials = name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3).toUpperCase();
      const u = await one<{ id: string }>(db, `insert into app.users (tenant_id, email, name, initials, job_title, scim_external_id, status) values (app.current_tenant(), $1, $2, $3, $4, $5, $6) returning id`,
        [email, name, initials, b.title ?? null, b.externalId ?? null, truthy(b.active ?? true) ? 'active' : 'revoked']);
      await db.query(`insert into app.user_roles (tenant_id, user_id, role) values (app.current_tenant(), $1, 'employee')`, [u.id]);
      await audit(db, 'user.create', 'User', email, `Provisioned ${name} from Entra ID (role: Employee)`, null, { email, name, title: b.title ?? null });
      await reconcileUser(db, u.id, 'New starter');
      return user(db, u.id);
    });
    return res ? send(reply, 201, userRes(res.p, res.ext)) : scimError(reply, 409, 'A user with that userName already exists');
  });

  const applyUser = async (db: Db, p: Person, changes: ScimUser) => {
    const before = { name: p.name, email: p.email, title: p.jobTitle, status: p.status };
    const name = changes.displayName ?? changes.name?.formatted;
    if (name || changes.userName || changes.title !== undefined || changes.externalId !== undefined) {
      await db.query('update app.users set name = coalesce($2, name), email = coalesce(lower($3), email), job_title = coalesce($4, job_title), scim_external_id = coalesce($5, scim_external_id), updated_at = now() where id = $1',
        [p.id, name ?? null, changes.userName ?? null, changes.title ?? null, changes.externalId ?? null]);
      await audit(db, 'user.update', 'User', p.email, `Entra ID updated ${p.name}`, before, { name: name ?? p.name, email: changes.userName ?? p.email, title: changes.title ?? p.jobTitle });
    }
    if (changes.active !== undefined) {
      const active = truthy(changes.active);
      if (active && p.status !== 'active') await setStatus(db, p, 'active', 'Re-enabled in Entra ID');
      if (!active && p.status === 'active') await setStatus(db, p, 'revoked', 'Disabled or unassigned in Entra ID');
    }
  };

  scim.patch('/Users/:id', async (req, reply) => {
    const ops = ((req.body ?? {}) as { Operations?: Op[] }).Operations ?? [];
    const r = await tx(async (db) => {
      const u = await user(db, (req.params as { id: string }).id);
      if (!u) return null;
      const changes: ScimUser = {};
      for (const o of ops) {
        if (!['replace', 'add'].includes(o.op.toLowerCase())) continue;
        if (!o.path && o.value && typeof o.value === 'object') Object.assign(changes, o.value);
        else if (o.path === 'active') changes.active = o.value as boolean | string;
        else if (o.path === 'displayName' || o.path === 'name.formatted') changes.displayName = String(o.value);
        else if (o.path === 'title') changes.title = String(o.value);
        else if (o.path === 'userName') changes.userName = String(o.value);
        else if (o.path === 'externalId') changes.externalId = String(o.value);
      }
      await applyUser(db, u.p, changes);
      return user(db, u.p.id);
    });
    return r ? send(reply, 200, userRes(r.p, r.ext)) : scimError(reply, 404, 'User not found');
  });

  scim.put('/Users/:id', async (req, reply) => {
    const r = await tx(async (db) => {
      const u = await user(db, (req.params as { id: string }).id);
      if (!u) return null;
      await applyUser(db, u.p, (req.body ?? {}) as ScimUser);
      return user(db, u.p.id);
    });
    return r ? send(reply, 200, userRes(r.p, r.ext)) : scimError(reply, 404, 'User not found');
  });

  // Records are never deleted: a deleted user becomes a leaver, and their completed records stay.
  scim.delete('/Users/:id', async (req, reply) => {
    const ok = await tx(async (db) => {
      const u = await user(db, (req.params as { id: string }).id);
      if (!u) return false;
      await setStatus(db, u.p, 'left', 'Deleted in Entra ID');
      return true;
    });
    return ok ? reply.code(204).send() : scimError(reply, 404, 'User not found');
  });

  // ---------- Groups ----------
  type G = { id: string; name: string; entra_group_id: string | null };
  scim.get('/Groups', async (req, reply) => {
    const q = (req.query ?? {}) as Record<string, string>;
    const out = await tx(async (db) => {
      const name = eqFilter(q.filter, 'displayName'), ext = eqFilter(q.filter, 'externalId');
      const gs = await rows<G>(db, 'select id, name, entra_group_id from app.groups where ($1::text is null or name = $1) and ($2::text is null or entra_group_id = $2) order by name', [name, ext]);
      return mapSeq(gs, (g) => groupRes(db, g));
    });
    return send(reply, 200, { schemas: [LIST], totalResults: out.length, startIndex: 1, itemsPerPage: out.length, Resources: out });
  });
  scim.get('/Groups/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const out = /^[0-9a-f-]{36}$/i.test(id) ? await tx(async (db) => { const g = await maybe<G>(db, 'select id, name, entra_group_id from app.groups where id = $1', [id]); return g ? groupRes(db, g) : null; }) : null;
    return out ? send(reply, 200, out) : scimError(reply, 404, 'Group not found');
  });
  scim.post('/Groups', async (req, reply) => {
    const b = (req.body ?? {}) as { displayName?: string; externalId?: string; members?: { value: string }[] };
    if (!b.displayName) return scimError(reply, 400, 'displayName is required');
    const out = await tx(async (db) => {
      if (await maybe(db, 'select 1 from app.groups where name = $1', [b.displayName])) return null;
      const g = await one<G>(db, 'insert into app.groups (tenant_id, name, entra_group_id) values (app.current_tenant(), $1, $2) returning id, name, entra_group_id', [b.displayName, b.externalId ?? null]);
      await audit(db, 'group.create', 'Group', g.name, `Entra ID created group ${g.name}`);
      await members(db, g, 'add', (b.members ?? []).map((m) => m.value));
      return groupRes(db, g);
    });
    return out ? send(reply, 201, out) : scimError(reply, 409, 'A group with that name already exists');
  });

  const members = async (db: Db, g: G, how: 'add' | 'remove', ids: string[]) => {
    const valid = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    for (const uid of valid) {
      const r = how === 'add'
        ? await db.query('insert into app.group_members (tenant_id, group_id, user_id) select app.current_tenant(), $1, id from app.users where id = $2 on conflict do nothing', [g.id, uid])
        : await db.query('delete from app.group_members where group_id = $1 and user_id = $2', [g.id, uid]);
      if (r.rowCount) {
        await audit(db, 'group.member', 'Group', g.name, `Entra ID ${how === 'add' ? 'added' : 'removed'} a member ${how === 'add' ? 'to' : 'from'} ${g.name}`, null, { user: uid, change: how });
        await reconcileUser(db, uid, `Group change (${g.name})`);
      }
    }
  };

  scim.patch('/Groups/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ops = ((req.body ?? {}) as { Operations?: Op[] }).Operations ?? [];
    const ok = /^[0-9a-f-]{36}$/i.test(id) && await tx(async (db) => {
      const g = await maybe<G>(db, 'select id, name, entra_group_id from app.groups where id = $1', [id]);
      if (!g) return false;
      for (const o of ops) {
        const op = o.op.toLowerCase();
        const values = Array.isArray(o.value) ? (o.value as { value: string }[]).map((v) => v.value) : [];
        const inPath = o.path?.match(/^members\[value eq "([^"]+)"\]$/i)?.[1];
        if (o.path === 'members' && op === 'add') await members(db, g, 'add', values);
        else if (o.path === 'members' && op === 'remove') await members(db, g, 'remove', values);
        else if (inPath && op === 'remove') await members(db, g, 'remove', [inPath]);
        else if (op === 'replace' && (o.path === 'displayName' || (!o.path && (o.value as { displayName?: string })?.displayName))) {
          const name = o.path ? String(o.value) : String((o.value as { displayName: string }).displayName);
          await db.query('update app.groups set name = $2 where id = $1', [g.id, name]);
          await audit(db, 'group.rename', 'Group', g.name, `Entra ID renamed group ${g.name} to ${name}`, { name: g.name }, { name });
        }
      }
      return true;
    });
    return ok ? reply.code(204).send() : scimError(reply, 404, 'Group not found');
  });
}
