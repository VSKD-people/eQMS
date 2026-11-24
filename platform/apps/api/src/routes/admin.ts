// Users and roles, settings, and the audit trail.
import type { FastifyInstance } from 'fastify';
import { maybe, one, rows, type Db } from '@veqms/db';
import { ROLES, type Role } from '@veqms/domain';
import type { Ctx } from '../app.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/http.ts';
import { people, type Person } from '../lib/people.ts';
import { checkLatest } from '../services/anchor.ts';
import { audit, notify } from '../lib/work.ts';
import { body, need, param, query, uuid, z } from '../lib/params.ts';
import { reconcileUser } from '../services/training.ts';

const id = { id: uuid };

// Segregation of duties: the System Administrator manages access but never approves quality records, and nobody
// changes their own access.
function checkRoles(me: Person, targetId: string, roles: Role[]): void {
  if (targetId === me.id) throw forbidden('You can’t change your own roles or groups. Ask another System Administrator.');
  if (roles.includes('admin') && (roles.includes('approver') || roles.includes('qm'))) throw conflict('A System Administrator can’t also be an Approver or Quality Manager (segregation of duties).');
}

async function load(db: Db, userId: string): Promise<Person> {
  const [p] = await people(db, [userId]);
  if (!p) throw notFound('That user doesn’t exist.');
  return p;
}

export async function setGroups(db: Db, userId: string, names: string[]): Promise<void> {
  const known = await rows<{ id: string; name: string }>(db, 'select id, name from app.groups where name = any($1::text[])', [names]);
  const missing = names.filter((n) => !known.some((k) => k.name === n));
  if (missing.length) throw badRequest(`Unknown group: ${missing.join(', ')}`);
  await db.query('delete from app.group_members where user_id = $1 and group_id <> all($2::uuid[])', [userId, known.map((k) => k.id)]);
  for (const g of known) await db.query('insert into app.group_members (tenant_id, group_id, user_id) values (app.current_tenant(), $1, $2) on conflict do nothing', [g.id, userId]);
}

export async function setStatus(db: Db, p: Person, status: 'active' | 'revoked' | 'left', reason: string): Promise<{ added: number; closed: number }> {
  if (status === p.status) return { added: 0, closed: 0 };
  await db.query(`update app.users set status = $2, left_on = case when $2 = 'left' then now() else left_on end,
    sessions_revoked_at = case when $2 <> 'active' then now() else sessions_revoked_at end where id = $1`, [p.id, status]);
  await audit(db, 'user.status', 'User', p.email, `${p.name}: access ${status === 'active' ? 'restored' : status === 'left' ? 'removed (leaver)' : 'revoked'}. ${reason}`, { status: p.status }, { status });
  return reconcileUser(db, p.id, status === 'active' ? 'Access restored' : status === 'left' ? 'Leaver' : 'Access revoked');
}

export function adminRoutes(api: FastifyInstance, ctx: Ctx): void {
  // ---------- Users ----------
  api.post('/users', (req) => ctx.run(req, async (db, me) => {
    need(me, 'admin.users');
    const b = body(z.object({ email: z.email().max(200), name: z.string().min(2).max(120), jobTitle: z.string().max(120).optional(),
      roles: z.array(z.enum(ROLES)).min(1), groups: z.array(z.string()).default([]), managerId: uuid.optional(),
      clearance: z.enum(['Public', 'Internal', 'Confidential', 'Restricted']).default('Internal') }), req.body);
    checkRoles(me, '', b.roles);
    const initials = b.name.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3).toUpperCase();
    const u = await one<{ id: string }>(db, `insert into app.users (tenant_id, email, name, initials, job_title, manager_id, clearance) values (app.current_tenant(), lower($1), $2, $3, $4, $5, $6) returning id`,
      [b.email, b.name, initials, b.jobTitle ?? null, b.managerId ?? null, b.clearance]);
    for (const r of b.roles) await db.query('insert into app.user_roles (tenant_id, user_id, role, granted_by) values (app.current_tenant(), $1, $2, $3)', [u.id, r, me.id]);
    await setGroups(db, u.id, b.groups);
    await audit(db, 'user.create', 'User', b.email, `Added ${b.name} with roles ${b.roles.join(', ')}`, null, { roles: b.roles, groups: b.groups, clearance: b.clearance });
    const t = await reconcileUser(db, u.id, 'New starter');
    return { id: u.id, training: t };
  }));

  api.put('/users/:id/roles', (req) => ctx.run(req, async (db, me) => {
    need(me, 'admin.users');
    const uid = param(id, req.params).id;
    const b = body(z.object({ roles: z.array(z.enum(ROLES)).min(1), reason: z.string().min(5).max(500) }), req.body);
    checkRoles(me, uid, b.roles);
    const p = await load(db, uid);
    const before = [...p.roles];
    await db.query('delete from app.user_roles where user_id = $1 and role <> all($2::text[])', [uid, b.roles]);
    for (const r of b.roles) await db.query('insert into app.user_roles (tenant_id, user_id, role, granted_by) values (app.current_tenant(), $1, $2, $3) on conflict do nothing', [uid, r, me.id]);
    await audit(db, 'user.roles', 'User', p.email, `Changed ${p.name}’s roles. Reason: ${b.reason}`, { roles: before }, { roles: b.roles });
    await notify(db, { to: [uid], kind: 'security', title: 'Your VeQMS roles changed', body: `Now: ${b.roles.join(', ')}`, email: true });
    return { roles: b.roles, training: await reconcileUser(db, uid, 'Role change') };
  }));

  api.put('/users/:id/groups', (req) => ctx.run(req, async (db, me) => {
    need(me, 'admin.users');
    const uid = param(id, req.params).id;
    if (uid === me.id) throw forbidden('You can’t change your own groups.');
    const b = body(z.object({ groups: z.array(z.string().min(1)).max(50) }), req.body);
    const p = await load(db, uid);
    await setGroups(db, uid, b.groups);
    await audit(db, 'user.groups', 'User', p.email, `Changed ${p.name}’s groups`, { groups: p.groups }, { groups: b.groups });
    return { groups: b.groups, training: await reconcileUser(db, uid, 'Group change') };
  }));

  api.put('/users/:id/status', (req) => ctx.run(req, async (db, me) => {
    need(me, 'admin.users');
    const uid = param(id, req.params).id;
    if (uid === me.id) throw forbidden('You can’t change your own access.');
    const b = body(z.object({ status: z.enum(['active', 'revoked', 'left']), reason: z.string().min(5).max(500) }), req.body);
    return { status: b.status, training: await setStatus(db, await load(db, uid), b.status, b.reason) };
  }));

  // Ends every session now: tokens issued before this moment are refused.
  api.post('/users/:id/revoke-sessions', (req) => ctx.run(req, async (db, me) => {
    need(me, 'admin.users');
    const p = await load(db, param(id, req.params).id);
    await db.query('update app.users set sessions_revoked_at = now() where id = $1', [p.id]);
    await audit(db, 'user.revoke-sessions', 'User', p.email, `Ended all sessions for ${p.name}`);
    return { ok: true };
  }));

  // ---------- Settings ----------
  const settingsSelect = `select signing_allowance as "signingAllowance", allowance_year_start_month as "allowanceYearStartMonth", allowance_warn_at as "allowanceWarnAt",
    signing_go_live as "signingGoLive", ack_statement as "ackStatement", reminder_days as "reminderDays", overdue_repeat_days as "overdueRepeatDays", signature_statement as "signatureStatement"
    from app.settings where tenant_id = app.current_tenant()`;
  api.get('/settings', (req) => ctx.run(req, (db) => one(db, settingsSelect)));
  api.put('/settings', (req) => ctx.run(req, async (db, me) => {
    need(me, 'admin.settings');
    const b = body(z.object({
      signingAllowance: z.number().int().min(1).max(100000), allowanceYearStartMonth: z.number().int().min(1).max(12), allowanceWarnAt: z.number().int().min(0).max(10000),
      ackStatement: z.string().min(10).max(500).refine((s) => s.includes('{doc}') && s.includes('{version}'), 'Must contain {doc} and {version}'),
      reminderDays: z.array(z.number().int().min(0).max(60)).max(10), overdueRepeatDays: z.number().int().min(1).max(60)
    }), req.body);
    const before = await one(db, settingsSelect);
    await db.query(`update app.settings set signing_allowance = $1, allowance_year_start_month = $2, allowance_warn_at = $3, ack_statement = $4, reminder_days = $5, overdue_repeat_days = $6, updated_at = now()
      where tenant_id = app.current_tenant()`, [b.signingAllowance, b.allowanceYearStartMonth, b.allowanceWarnAt, b.ackStatement, b.reminderDays, b.overdueRepeatDays]);
    await audit(db, 'settings', 'Settings', 'tenant', 'Changed settings', before, b);
    return one(db, settingsSelect);
  }));

  // ---------- Audit trail ----------
  api.get('/audit', (req) => ctx.run(req, async (db, me) => {
    need(me, 'audit.read');
    const q = query({ objectType: z.string().max(40).optional(), objectId: z.string().max(100).optional(), action: z.string().max(40).optional(),
      before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) }, req.query);
    const list = await rows<{ seq: string; at: Date; actor_label: string; action: string; object_type: string; object_id: string; summary: string; before: unknown; after: unknown; hash: string }>(db,
      `select seq, at, actor_label, action, object_type, object_id, summary, before, after, hash from app.audit_log
       where ($1::text is null or object_type = $1) and ($2::text is null or object_id = $2) and ($3::text is null or action like $3 || '%') and ($4::bigint is null or seq < $4)
       order by seq desc limit $5`, [q.objectType ?? null, q.objectId ?? null, q.action ?? null, q.before ?? null, q.limit]);
    await audit(db, 'audit.read', 'Audit trail', q.objectId ?? '*', `Viewed the audit trail${q.objectId ? ' for ' + q.objectId : ''}`);
    return list.map((a) => ({ seq: Number(a.seq), at: new Date(a.at).toISOString(), actor: a.actor_label, action: a.action, objectType: a.object_type, objectId: a.object_id, summary: a.summary, before: a.before, after: a.after, hash: a.hash }));
  }));
  api.get('/audit/verify', (req) => ctx.run(req, async (db, me) => {
    need(me, 'audit.read');
    const r = await maybe<{ ok: boolean; entries: string; broken_at: string | null }>(db, 'select * from app.verify_audit_chain()');
    const anchorCheck = await checkLatest(db, ctx.storage);
    const anchorNote = !anchorCheck.anchored ? 'no anchor yet' : anchorCheck.matches ? `latest anchor (entry ${anchorCheck.seq}) matches` : `ANCHOR MISMATCH: ${anchorCheck.problem}`;
    await audit(db, 'audit.verify', 'Audit trail', '*', r?.ok ? `Verified the audit chain: ${r.entries} entries intact; ${anchorNote}` : `Audit chain check FAILED at entry ${r?.broken_at}; ${anchorNote}`);
    return { ok: !!r?.ok && anchorCheck.matches !== false, entries: Number(r?.entries ?? 0), brokenAt: r?.broken_at ? Number(r.broken_at) : null, anchor: anchorCheck };
  }));
}
