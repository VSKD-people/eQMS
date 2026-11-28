// The Adobe Sign webhook queue (app.webhook_inbox). The webhook route only records a notification and answers at
// once; this worker handles it afterwards: it finds the agreement, records that a notification arrived, and reads the
// agreement from Adobe Sign ("the webhook notifies, the API confirms"). A repeated notification ID is ignored.
// Failures are retried with back-off; after MAX_ATTEMPTS the notification goes to dead_letters and Quality Managers
// are told. The daily job's status check on agreements out for more than a day is the safety net behind all this.
import { createHash } from 'node:crypto';
import { rows, withTenant, type Pool } from '@veqms/db';
import * as signing from './agreements.ts';
import type { Deps } from './agreements.ts';
import { notify } from '../lib/work.ts';

export const MAX_ATTEMPTS = 8;

export interface Notification { eventId: string | null; event: string | null; providerAgreementId: string | null; raw: Buffer }

// Record a notification. Returns false when the same notification ID was already recorded (a repeat delivery).
export async function enqueue(pool: Pool, n: Notification): Promise<boolean> {
  const sha = createHash('sha256').update(n.raw).digest('hex');
  const r = await pool.query(`insert into app.webhook_inbox (event_id, event, provider_agreement_id, payload_sha256) values ($1, $2, $3, $4)
    on conflict (provider, event_id) do nothing`, [n.eventId || `sha256:${sha}`, n.event, n.providerAgreementId, sha]);
  return (r.rowCount ?? 0) > 0;
}

// 1, 2, 4 … minutes between attempts, at most 6 hours.
export function backoffMinutes(attempts: number): number {
  return Math.min(360, 2 ** Math.max(0, attempts - 1));
}

type Claimed = { id: string; event: string | null; provider_agreement_id: string | null; payload_sha256: string; attempts: number };

// Work through due notifications, one at a time. Each claim moves the row's next attempt 5 minutes on, as a lease:
// if the process stops half-way, the row comes round again. SKIP LOCKED lets several API instances share the queue.
export async function drainInbox(pool: Pool, deps: Deps, limit = 100): Promise<{ processed: number; retrying: number; gaveUp: number }> {
  const out = { processed: 0, retrying: 0, gaveUp: 0 };
  for (let i = 0; i < limit; i++) {
    const row = (await pool.query<Claimed>(`update app.webhook_inbox set attempts = attempts + 1, next_attempt_at = now() + interval '5 minutes'
      where id = (select id from app.webhook_inbox where processed_at is null and next_attempt_at <= now() order by id for update skip locked limit 1)
      returning id, event, provider_agreement_id, payload_sha256, attempts`)).rows[0];
    if (!row) break;
    const hit = row.provider_agreement_id
      ? (await pool.query<{ tenant_id: string; agreement_id: string }>('select tenant_id, agreement_id from app.agreement_directory where provider_agreement_id = $1', [row.provider_agreement_id])).rows[0]
      : undefined;
    try {
      if (hit) {
        await withTenant(pool, { tenantId: hit.tenant_id, userId: null }, async (db) => {
          await signing.webhookReceived(db, hit.agreement_id, row.payload_sha256, row.event ?? '');
          await signing.fromProvider(db, deps, hit.agreement_id, 'webhook');
        });
      }
      await pool.query('update app.webhook_inbox set processed_at = now(), last_error = $2 where id = $1', [row.id, hit ? null : 'Not a VeQMS agreement: ignored']);
      out.processed++;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 500);
      if (row.attempts < MAX_ATTEMPTS) {
        await pool.query('update app.webhook_inbox set next_attempt_at = now() + make_interval(mins => $2), last_error = $3 where id = $1', [row.id, backoffMinutes(row.attempts), msg]);
        out.retrying++;
        continue;
      }
      await pool.query('update app.webhook_inbox set processed_at = now(), last_error = $2 where id = $1', [row.id, `Gave up after ${row.attempts} attempts: ${msg}`]);
      out.gaveUp++;
      if (hit) {
        await withTenant(pool, { tenantId: hit.tenant_id, userId: null }, async (db) => {
          await db.query(`insert into app.dead_letters (tenant_id, job, payload, attempts, last_error) values (app.current_tenant(), 'adobe-sign-webhook', $1, $2, $3)`,
            [JSON.stringify({ inboxId: row.id, event: row.event, providerAgreementId: row.provider_agreement_id }), row.attempts, msg]);
          const qms = await rows<{ id: string }>(db, `select u.id from app.users u join app.user_roles r on r.user_id = u.id and r.role = 'qm' where u.status = 'active'`);
          await notify(db, { to: qms.map((q) => q.id), kind: 'warn', title: 'An Adobe Sign status update could not be applied',
            body: `After ${row.attempts} attempts: ${msg}. The daily status check will try the agreement again; use Check status with Adobe Sign to try now.`, href: `/approvals/${hit.agreement_id}` });
        }).catch(() => undefined);
      }
    }
  }
  return out;
}

// One worker per API process: kick() after a notification is queued, and a timer for retries. Runs one drain at a time.
export function createInboxWorker(pool: Pool, deps: Deps, log: { error: (o: object, m: string) => void }) {
  let running = false, again = false, timer: NodeJS.Timeout | null = null;
  const kick = (): void => {
    if (running) { again = true; return; }
    running = true;
    drainInbox(pool, deps)
      .catch((e) => log.error({ err: { message: String((e as Error)?.message ?? e) } }, 'Adobe Sign webhook queue failed'))
      .finally(() => { running = false; if (again) { again = false; kick(); } });
  };
  return {
    kick,
    start(everyMs = 60_000) { timer = setInterval(kick, everyMs); timer.unref(); },
    stop() { if (timer) clearInterval(timer); timer = null; }
  };
}
