// Envelopes, the sends log, the approvals register, and (mock mode only) signing on a signer's behalf for testing.
import type { FastifyInstance } from 'fastify';
import { DOC_TYPES } from '@veqms/domain';
import type { Ctx } from '../app.ts';
import { forbidden } from '../lib/http.ts';
import { body, need, param, pdf, query, uuid, z } from '../lib/params.ts';
import * as env from '../services/envelopes.ts';
import * as docs from '../services/documents.ts';

const id = { id: uuid };

export function envelopeRoutes(api: FastifyInstance, ctx: Ctx): void {
  api.get('/docusign/allowance', (req) => ctx.run(req, (db) => env.allowance(db)));

  // The whole sends log needs approvals.view; one record's envelopes (?record=POL-004) are open to anyone who can see the record.
  api.get('/envelopes', (req) => ctx.run(req, async (db, me) => {
    const q = query({ year: z.coerce.number().int().min(2000).max(2100).optional(), status: z.enum(['sent', 'completed', 'declined', 'voided']).optional(),
      record: z.string().regex(/^[A-Z]{2,5}-\d{1,6}$/).optional() }, req.query);
    const rec = q.record;
    if (rec) { if (DOC_TYPES.some((t) => rec.startsWith(t.prefix + '-'))) await docs.assertVisible(db, me, await docs.docByNumber(db, rec)); }
    else need(me, 'approvals.view');
    return { allowance: await env.allowance(db), items: await env.list(db, q) };
  }));

  api.get('/envelopes/:id', (req) => ctx.run(req, (db, me) => env.detail(db, me, param(id, req.params).id)));

  api.post('/envelopes/:id/void', (req) => ctx.run(req, (db, me) => {
    const b = body(z.object({ reason: z.string().min(5).max(200) }), req.body);
    return env.voidEnvelope(db, ctx, me, param(id, req.params).id, b.reason);
  }));

  // Fallback for a missed Connect message: ask DocuSign for the envelope's status now.
  api.post('/envelopes/:id/refresh', (req) => ctx.run(req, async (db) => {
    const e = param(id, req.params).id;
    if (ctx.docusign.mode === 'live') await env.fromDocuSign(db, ctx, e, 'poll');
    return env.summary(db, await env.byId(db, e));
  }));

  api.get('/envelopes/:id/files/:kind', async (req, reply) => {
    const p = param({ id: uuid, kind: z.enum(['original', 'signed', 'certificate']) }, req.params);
    const f = await ctx.run(req, (db, me) => env.file(db, ctx, me, p.id, p.kind));
    return pdf(reply, f.bytes, f.name);
  });

  api.get('/approvals/register', (req) => ctx.run(req, (db, me) => { need(me, 'approvals.view'); return env.register(db); }));

  // Development and UAT only. In live mode signers sign in DocuSign from the DocuSign email.
  api.post('/envelopes/:id/mock/sign', (req) => ctx.run(req, (db, me) => {
    if (ctx.docusign.mode !== 'mock') throw forbidden('Signers sign in DocuSign.');
    return env.mockAct(db, ctx, me, param(id, req.params).id, 'sign');
  }));
  api.post('/envelopes/:id/mock/decline', (req) => ctx.run(req, (db, me) => {
    if (ctx.docusign.mode !== 'mock') throw forbidden('Signers decline in DocuSign.');
    const b = body(z.object({ reason: z.string().min(5).max(200) }), req.body);
    return env.mockAct(db, ctx, me, param(id, req.params).id, 'decline', b.reason);
  }));
}
