// Agreements, the sends log, the approvals register, and (mock mode only) signing on a signer's behalf for testing.
import type { FastifyInstance } from 'fastify';
import { DOC_TYPES } from '@veqms/domain';
import type { Ctx } from '../app.ts';
import { forbidden } from '../lib/http.ts';
import { body, need, param, pdf, query, uuid, z } from '../lib/params.ts';
import * as signing from '../services/agreements.ts';
import * as docs from '../services/documents.ts';

const id = { id: uuid };

export function agreementRoutes(api: FastifyInstance, ctx: Ctx): void {
  api.get('/signing/allowance', (req) => ctx.run(req, (db) => signing.allowance(db)));

  // The whole sends log needs approvals.view; one record's agreements (?record=POL-004) are open to anyone who can see the record.
  api.get('/agreements', (req) => ctx.run(req, async (db, me) => {
    const q = query({ year: z.coerce.number().int().min(2000).max(2100).optional(), status: z.enum(['sent', 'completed', 'declined', 'cancelled']).optional(),
      record: z.string().regex(/^[A-Z]{2,5}-\d{1,6}$/).optional() }, req.query);
    const rec = q.record;
    if (rec) { if (DOC_TYPES.some((t) => rec.startsWith(t.prefix + '-'))) await docs.assertVisible(db, me, await docs.docByNumber(db, rec)); }
    else need(me, 'approvals.view');
    return { allowance: await signing.allowance(db), items: await signing.list(db, q) };
  }));

  api.get('/agreements/:id', (req) => ctx.run(req, (db, me) => signing.detail(db, me, param(id, req.params).id)));

  api.post('/agreements/:id/cancel', (req) => ctx.run(req, (db, me) => {
    const b = body(z.object({ reason: z.string().min(5).max(200) }), req.body);
    return signing.cancelAgreement(db, ctx, me, param(id, req.params).id, b.reason);
  }));

  // Fallback for a missed webhook notification: ask Adobe Sign for the agreement's status now.
  api.post('/agreements/:id/refresh', (req) => ctx.run(req, async (db) => {
    const e = param(id, req.params).id;
    if (ctx.esign.mode === 'live') await signing.fromProvider(db, ctx, e, 'poll');
    return signing.summary(db, await signing.byId(db, e));
  }));

  api.get('/agreements/:id/files/:kind', async (req, reply) => {
    const p = param({ id: uuid, kind: z.enum(['original', 'signed', 'audit-report']) }, req.params);
    const f = await ctx.run(req, (db, me) => signing.file(db, ctx, me, p.id, p.kind));
    return pdf(reply, f.bytes, f.name);
  });

  api.get('/approvals/register', (req) => ctx.run(req, (db, me) => { need(me, 'approvals.view'); return signing.register(db); }));

  // Development and UAT only. In live mode signers sign in Adobe Sign from the Adobe Sign email.
  api.post('/agreements/:id/mock/sign', (req) => ctx.run(req, (db, me) => {
    if (ctx.esign.mode !== 'mock') throw forbidden('Signers sign in Adobe Sign.');
    return signing.mockAct(db, ctx, me, param(id, req.params).id, 'sign');
  }));
  api.post('/agreements/:id/mock/decline', (req) => ctx.run(req, (db, me) => {
    if (ctx.esign.mode !== 'mock') throw forbidden('Signers decline in Adobe Sign.');
    const b = body(z.object({ reason: z.string().min(5).max(200) }), req.body);
    return signing.mockAct(db, ctx, me, param(id, req.params).id, 'decline', b.reason);
  }));
}
