// Adobe Sign webhooks. "The webhook notifies, the API confirms": a notification is accepted only on the secret URL
// (ADOBE_SIGN_WEBHOOK_TOKEN) with the expected X-AdobeSign-ClientId, and VeQMS then reads the agreement from Adobe
// Sign itself and acts on that, never on the notification body. Adobe Sign retries failed deliveries, so handling is
// idempotent (a final agreement ignores repeats).
// Every reply echoes the client ID, as Adobe Sign requires, including the "verification of intent" GET it sends when
// the webhook is created. Verify against Adobe's current webhook guide before go-live: the header name, the echo, and
// the notification JSON (agreement.id, event).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { withTenant } from '@veqms/db';
import { ADOBE_CLIENT_ID_HEADER, secretMatches, webhookEcho } from '@veqms/domain';
import type { Ctx } from '../app.ts';
import * as signing from '../services/agreements.ts';

export function webhookRoutes(hooks: FastifyInstance, ctx: Ctx): void {
  // The payload hash is over the exact bytes received, so this scope keeps the raw body instead of parsing JSON.
  // Content-type parsers are scoped to this plugin (Fastify encapsulation); the rest of the API still parses JSON.
  hooks.removeAllContentTypeParsers();
  hooks.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, raw, done) => done(null, raw));

  // Both checks, or a plain 404 that says nothing about why.
  function accepted(req: FastifyRequest<{ Params: { token: string } }>): string | null {
    if (ctx.cfg.ADOBE_SIGN_MODE !== 'live' || !secretMatches(ctx.cfg.ADOBE_SIGN_WEBHOOK_TOKEN, req.params.token)) return null;
    const given = req.headers[ADOBE_CLIENT_ID_HEADER];
    const clientId = typeof given === 'string' ? given : '';
    if (ctx.cfg.webhookClientId && !secretMatches(ctx.cfg.webhookClientId, clientId)) return null;
    return clientId;
  }
  const echo = (reply: FastifyReply, clientId: string, body: Record<string, unknown> = {}) =>
    reply.code(200).header('X-AdobeSign-ClientId', clientId).send({ ...webhookEcho(clientId), ...body });

  // Verification of intent: Adobe Sign calls this when the webhook is created or re-enabled.
  hooks.get<{ Params: { token: string } }>('/webhooks/adobe-sign/:token', async (req, reply) => {
    const clientId = accepted(req);
    if (clientId === null) { req.log.warn('Adobe Sign webhook check refused'); return reply.code(404).send(); }
    return echo(reply, clientId);
  });

  hooks.post<{ Params: { token: string } }>('/webhooks/adobe-sign/:token', async (req, reply) => {
    const clientId = accepted(req);
    if (clientId === null) { req.log.warn('Adobe Sign webhook notification refused'); return reply.code(404).send(); }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    let msg: { event?: string; agreement?: { id?: string } };
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return echo(reply, clientId, { ignored: 'not JSON' }); }
    const providerId = msg.agreement?.id;
    if (!providerId) return echo(reply, clientId, { ignored: 'no agreement id' });

    // The directory has no row-level security: it only maps an Adobe Sign agreement ID to its tenant.
    const dir = await ctx.pool.query<{ tenant_id: string; agreement_id: string }>('select tenant_id, agreement_id from app.agreement_directory where provider_agreement_id = $1', [providerId]);
    const hit = dir.rows[0];
    if (!hit) return echo(reply, clientId, { ignored: 'unknown agreement' });

    const sha = createHash('sha256').update(raw).digest('hex');
    await withTenant(ctx.pool, { tenantId: hit.tenant_id, userId: null }, async (db) => {
      await signing.webhookReceived(db, hit.agreement_id, sha, msg.event ?? '');
      await signing.fromProvider(db, ctx, hit.agreement_id, 'webhook');
    });
    return echo(reply, clientId);
  });
}
