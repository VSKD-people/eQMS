// Loading people with their roles and groups, as the domain rules expect them.
import { rows, maybe, type Db } from '@veqms/db';
import type { Role, UserRef } from '@veqms/domain';

export interface Person extends UserRef {
  initials: string;
  jobTitle: string | null;
  clearance: string;
  managerId: string | null;
  entraOid: string | null;
  sessionsRevokedAt: string | null;
}

const SELECT = `
  select u.id, u.name, u.email, u.status, u.initials, u.job_title, u.clearance, u.manager_id, u.entra_oid, u.sessions_revoked_at,
         coalesce((select array_agg(r.role order by r.role) from app.user_roles r where r.user_id = u.id), '{}') as roles,
         coalesce((select array_agg(g.name order by g.name) from app.group_members m join app.groups g on g.id = m.group_id where m.user_id = u.id), '{}') as groups
  from app.users u`;

type Row = { id: string; name: string; email: string; status: Person['status']; initials: string; job_title: string | null; clearance: string; manager_id: string | null; entra_oid: string | null; sessions_revoked_at: Date | null; roles: Role[]; groups: string[] };

function map(r: Row): Person {
  return { id: r.id, name: r.name, email: r.email, status: r.status, initials: r.initials, jobTitle: r.job_title, clearance: r.clearance, managerId: r.manager_id,
    entraOid: r.entra_oid, sessionsRevokedAt: r.sessions_revoked_at ? new Date(r.sessions_revoked_at).toISOString() : null, roles: r.roles, groups: r.groups };
}

export async function person(db: Db, id: string): Promise<Person | null> {
  const r = await maybe<Row>(db, SELECT + ' where u.id = $1', [id]);
  return r ? map(r) : null;
}
export async function personByOid(db: Db, oid: string): Promise<Person | null> {
  const r = await maybe<Row>(db, SELECT + ' where u.entra_oid = $1', [oid]);
  return r ? map(r) : null;
}
export async function personByEmail(db: Db, email: string): Promise<Person | null> {
  const r = await maybe<Row>(db, SELECT + ' where lower(u.email) = lower($1)', [email]);
  return r ? map(r) : null;
}
export async function people(db: Db, ids?: string[]): Promise<Person[]> {
  const list = ids ? await rows<Row>(db, SELECT + ' where u.id = any($1::uuid[]) order by u.name', [ids]) : await rows<Row>(db, SELECT + ' order by u.name');
  return list.map(map);
}
export function ref(p: { id: string; name: string } | null | undefined): { id: string; name: string } | null {
  return p ? { id: p.id, name: p.name } : null;
}

const CLASSES = ['Public', 'Internal', 'Confidential', 'Restricted'];
// Classification check, as in the prototype: clearance at or above the class, or named on the record.
export function canSee(p: Person, classification: string, involved: boolean): boolean {
  return CLASSES.indexOf(p.clearance) >= CLASSES.indexOf(classification) || involved;
}
