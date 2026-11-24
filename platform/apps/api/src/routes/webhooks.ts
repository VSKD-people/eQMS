// DocuSign Connect. "Connect notifies, the API confirms": the message is checked with HMAC, then the API reads the
// envelope from DocuSign itself and acts on that, never on the message body alone. Connect retries failed deliveries,
// so handling is idempotent (a final envelope ignores repeats).
// Verify against the current DocuSign Connect docs before go-live: the JSON (SIM) message format with
// data.envelopeId, the X-DocuSign-Signature-N headers, and the retry behaviour.
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { withTenant } from '@veqms/db';
import { verifyConnectHmac } from '@veqms/domain';
import type { Ctx } from '../app.ts';
import * as env from '../services/envelopes.ts';

export function webhookRoutes(hooks: FastifyInstance, ctx: Ctx): void {
  // The HMAC is over the exact bytes received, so this scope keeps the raw body instead of parsing JSON.
  // Content-type parsers are scoped to this plugin (Fastify encapsulation); the rest of the API still parses JSON.
  hooks.removeAllContentTypeParsers();
  hooks.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, raw, done) => done(null, raw));

  hooks.post('/webhooks/docusign', async (req, reply) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const sigs = [1, 2, 3, 4, 5].map((n) => { const v = req.headers[`x-docusign-signature-${n}`]; return typeof v === 'string' ? v : undefined; });
    if (!verifyConnectHmac(ctx.cfg.connectHmacKeys, raw, sigs)) {
      req.log.warn('DocuSign Connect message refused: HMAC check failed');
      return reply.code(401).send({ error: { code: 'unauthorised', message: 'Signature check failed.' } });
    }
    let msg: { event?: string; data?: { envelopeId?: string; envelopeSummary?: { status?: string } }; envelopeId?: string };
    try { msg = JSON.parse(raw.toString('utf8')); } catch { return reply.code(400).send({ error: { code: 'bad_request', message: 'Not JSON.' } }); }
    const dsId = msg.data?.envelopeId ?? msg.envelopeId;
    if (!dsId) return reply.code(200).send({ ok: true, ignored: 'no envelope id' });

    // The directory has no row-level security: it only maps a DocuSign envelope ID to its tenant.
    const dir = await ctx.pool.query<{ tenant_id: string; envelope_id: string }>('select tenant_id, envelope_id from app.envelope_directory where docusign_envelope_id = $1', [dsId]);
    const hit = dir.rows[0];
    if (!hit) return reply.code(200).send({ ok: true, ignored: 'unknown envelope' });

    const sha = createHash('sha256').update(raw).digest('hex');
    await withTenant(ctx.pool, { tenantId: hit.tenant_id, userId: null }, async (db) => {
      await env.connectReceived(db, hit.envelope_id, sha, msg.event ?? msg.data?.envelopeSummary?.status ?? '');
      await env.fromDocuSign(db, ctx, hit.envelope_id, 'connect');
    });
    return reply.code(200).send({ ok: true });
  });
}
