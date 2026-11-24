// Session, tasks, notifications, people and groups.
import type { FastifyInstance } from 'fastify';
import { rows } from '@veqms/db';
import { PERMISSIONS, can, type Permission } from '@veqms/domain';
import type { Ctx } from '../app.ts';
import { forbidden } from '../lib/http.ts';
import { people } from '../lib/people.ts';
import { noContent, param, uuid } from '../lib/params.ts';

export function coreRoutes(api: FastifyInstance, ctx: Ctx): void {
  api.get('/me', (req) => ctx.run(req, async (_db, me, auth) => ({
    user: { id: me.id, name: me.name, email: me.email, initials: me.initials, jobTitle: me.jobTitle, roles: me.roles, groups: me.groups, clearance: me.clearance },
    permissions: (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(me.roles, p)),
    tenant: { id: auth.tenantId, name: auth.tenantName },
    via: auth.via,
    esignMode: ctx.esign.mode
  })));

  api.get('/tasks', (req) => ctx.run(req, async (db, me) => {
    const list = await rows<{ id: string; kind: string; record_type: string; record_id: string; record_number: string; title: string | null; due_at: Date | null; note: string | null; ref: string | null; fyi: boolean }>(db, `
      select t.id, t.kind, t.record_type, t.record_id, t.record_number, coalesce(d.title, c.title, q.title) as title, t.due_at, t.note, t.ref, t.fyi
      from app.tasks t
        left join app.documents d on t.record_type = 'document' and d.id = t.record_id
        left join app.capas c on t.record_type = 'capa' and c.id = t.record_id
        left join app.quality_events q on t.record_type = 'quality_event' and q.id = t.record_id
      where t.assignee_id = $1 and t.status = 'open'
      order by t.fyi, t.due_at nulls last, t.created_at`, [me.id]);
    return list.map((t) => ({ id: t.id, kind: t.kind, recordType: t.record_type, recordId: t.record_id, recordNumber: t.record_number, title: t.title ?? t.record_number,
      dueAt: t.due_at ? new Date(t.due_at).toISOString() : null, note: t.note, ref: t.ref, fyi: t.fyi }));
  }));

  api.get('/notifications', (req) => ctx.run(req, async (db, me) => {
    const list = await rows<{ id: string; kind: string; title: string; body: string; href: string | null; created_at: Date; read_at: Date | null; mandatory: boolean }>(db,
      'select id, kind, title, body, href, created_at, read_at, mandatory from app.notifications where user_id = $1 order by created_at desc limit 100', [me.id]);
    return list.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, href: n.href, mandatory: n.mandatory, createdAt: new Date(n.created_at).toISOString(), readAt: n.read_at ? new Date(n.read_at).toISOString() : null }));
  }));

  api.post('/notifications/:id/read', async (req, reply) => {
    const { id } = param({ id: uuid }, req.params);
    await ctx.run(req, (db, me) => db.query('update app.notifications set read_at = coalesce(read_at, now()) where id = $1 and user_id = $2', [id, me.id]));
    return noContent(reply);
  });

  api.get('/users', (req) => ctx.run(req, async (db, me) => {
    // Everyone can pick people (reviewers, approvers, audiences); the full list with roles is for managers of the system.
    const full = me.roles.some((r) => ['qm', 'admin', 'auditor', 'process'].includes(r));
    const ps = await people(db);
    return ps.filter((p) => full || p.status === 'active').map((p) => full
      ? { id: p.id, name: p.name, email: p.email, jobTitle: p.jobTitle, status: p.status, roles: p.roles, groups: p.groups, clearance: p.clearance }
      : { id: p.id, name: p.name, jobTitle: p.jobTitle, status: p.status, roles: p.roles, groups: p.groups });
  }));

  api.get('/users/:id', (req) => ctx.run(req, async (db, me) => {
    const { id } = param({ id: uuid }, req.params);
    if (id !== me.id && !can(me.roles, 'training.org') && !can(me.roles, 'admin.users')) throw forbidden();
    const [p] = await people(db, [id]);
    if (!p) throw forbidden();
    return { id: p.id, name: p.name, email: p.email, jobTitle: p.jobTitle, status: p.status, roles: p.roles, groups: p.groups, clearance: p.clearance, managerId: p.managerId };
  }));

  api.get('/groups', (req) => ctx.run(req, (db) => rows(db, `
    select g.id, g.name, g.description, (select count(*)::int from app.group_members m join app.users u on u.id = m.user_id and u.status = 'active' where m.group_id = g.id) as members
    from app.groups g order by g.name`)));
}
