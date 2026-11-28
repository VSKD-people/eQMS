// Sends queued email notifications through Microsoft Graph (sendMail as a shared mailbox), run by the daily job.
// The notification log is insert-only, so each attempt adds a row ('sent' or 'failed'); a queued row with a later
// 'sent' row for the same notification is done.
// Check before go-live: the Graph sendMail endpoint and payload, the Mail.Send application permission, and an
// Exchange application access policy that limits the app to the one mailbox (see docs/05-deployment-azure.md).
import { withTenant, type Pool } from '@veqms/db';
import type { Config } from '../config.ts';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

export async function sendQueuedEmail(pool: Pool, cfg: Config, tenantId: string): Promise<{ sent: number; failed: number; skipped: number }> {
  return withTenant(pool, { tenantId, userId: null }, async (db) => {
    const queued = await db.query<{ notification_id: string; user_id: string; email: string; name: string; title: string; body: string; href: string | null }>(`
      select q.notification_id, q.user_id, u.email, u.name, n.title, n.body, n.href
      from app.notification_log q join app.notifications n on n.id = q.notification_id join app.users u on u.id = q.user_id
      where q.channel = 'email' and q.status = 'queued' and u.status = 'active'
        and not exists (select 1 from app.notification_log d where d.notification_id = q.notification_id and d.channel = 'email' and d.status in ('sent', 'skipped'))
        and (select count(*) from app.notification_log f where f.notification_id = q.notification_id and f.channel = 'email' and f.status = 'failed') < 3
      order by q.at limit 500`);
    if (!queued.rows.length) return { sent: 0, failed: 0, skipped: 0 };
    const log = (n: { notification_id: string; user_id: string }, status: string, detail: string) =>
      db.query(`insert into app.notification_log (tenant_id, notification_id, user_id, channel, status, detail) values (app.current_tenant(), $1, $2, 'email', $3, $4)`, [n.notification_id, n.user_id, status, detail]);

    if (!cfg.GRAPH_MAIL_FROM) {
      for (const n of queued.rows) await log(n, 'skipped', 'Email not configured (GRAPH_MAIL_FROM is empty)');
      return { sent: 0, failed: 0, skipped: queued.rows.length };
    }
    const { DefaultAzureCredential } = await import('@azure/identity');
    const t = await new DefaultAzureCredential().getToken(GRAPH_SCOPE);
    if (!t) throw new Error('No Entra ID token for Microsoft Graph. Check the managed identity.');
    const token = t.token;
    let sent = 0, failed = 0;
    for (const n of queued.rows) {
      const link = n.href ? new URL(n.href, cfg.APP_BASE_URL).toString() : cfg.APP_BASE_URL;
      const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.GRAPH_MAIL_FROM)}/sendMail`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: { subject: `VeQMS: ${n.title}`, body: { contentType: 'Text', content: `${n.body}\n\nOpen VeQMS: ${link}` },
          toRecipients: [{ emailAddress: { address: n.email, name: n.name } }] }, saveToSentItems: false })
      }).catch((e: unknown) => ({ ok: false, status: 0, text: async () => String(e) }));
      if (res.ok) { sent++; await log(n, 'sent', 'Sent through Microsoft Graph'); }
      else { failed++; await log(n, 'failed', `Graph ${res.status}: ${(await res.text()).slice(0, 200)}`); }
    }
    return { sent, failed, skipped: 0 };
  });
}
