// Tasks, notifications and the audit helper. Everything here runs inside the request's transaction.
import { rows, type Db } from '@veqms/db';

export async function audit(db: Db, action: string, objectType: string, objectId: string, summary: string, before: unknown = null, after: unknown = null): Promise<void> {
  await db.query('select app.audit($1, $2, $3, $4, $5::jsonb, $6::jsonb)', [action, objectType, objectId, summary,
    before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)]);
}

export interface TaskInput {
  kind: string; recordType: 'document' | 'capa' | 'quality_event'; recordId: string; recordNumber: string;
  assigneeId: string; dueAt?: Date | string | null; note?: string | null; ref?: string | null; fyi?: boolean;
}
export async function addTask(db: Db, t: TaskInput): Promise<void> {
  await db.query(`insert into app.tasks (tenant_id, kind, record_type, record_id, record_number, assignee_id, due_at, note, ref, fyi)
    values (app.current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [t.kind, t.recordType, t.recordId, t.recordNumber, t.assigneeId, t.dueAt ?? null, t.note ?? null, t.ref ?? null, t.fyi ?? false]);
}
export async function closeTasks(db: Db, where: { recordId: string; kinds?: string[]; assigneeId?: string; ref?: string }): Promise<number> {
  const r = await db.query(`update app.tasks set status = 'done', done_at = now()
    where status = 'open' and record_id = $1 and ($2::text[] is null or kind = any($2)) and ($3::uuid is null or assignee_id = $3) and ($4::uuid is null or ref = $4)`,
    [where.recordId, where.kinds ?? null, where.assigneeId ?? null, where.ref ?? null]);
  return r.rowCount ?? 0;
}

export interface NotifyInput {
  to: string[]; kind: 'action' | 'info' | 'fyi' | 'reminder' | 'overdue' | 'warn' | 'security';
  title: string; body?: string; recordType?: string; recordId?: string; href?: string; mandatory?: boolean; email?: boolean;
}
// In-app always; email is queued in the notification log and sent by the mail job (see jobs/reminders.ts).
export async function notify(db: Db, n: NotifyInput): Promise<void> {
  const to = [...new Set(n.to.filter(Boolean))];
  if (!to.length) return;
  const active = await rows<{ id: string }>(db, `select id from app.users where id = any($1::uuid[]) and status = 'active'`, [to]);
  for (const u of active) {
    const channels = n.email === false ? ['in-app'] : ['in-app', 'email'];
    const r = await rows<{ id: string }>(db, `insert into app.notifications (tenant_id, user_id, kind, title, body, record_type, record_id, href, mandatory, channels)
      values (app.current_tenant(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [u.id, n.kind, n.title, n.body ?? '', n.recordType ?? null, n.recordId ?? null, n.href ?? null, n.mandatory ?? false, channels]);
    for (const c of channels) {
      await db.query(`insert into app.notification_log (tenant_id, notification_id, user_id, channel, status) values (app.current_tenant(), $1, $2, $3, $4)`,
        [r[0]!.id, u.id, c, c === 'in-app' ? 'delivered' : 'queued']);
    }
  }
}

export async function automationRan(db: Db, rule: string, recordType: string | null, recordId: string | null, result: string, detail: string): Promise<void> {
  await db.query(`insert into app.automation_runs (tenant_id, rule_code, record_type, record_id, result, detail) values (app.current_tenant(), $1, $2, $3, $4, $5)`,
    [rule, recordType, recordId, result, detail]);
}

export function dueIn(days: number): Date { return new Date(Date.now() + days * 86_400_000); }
