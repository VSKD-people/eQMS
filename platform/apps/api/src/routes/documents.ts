// Documents: draft, review, the DocuSign approval send, audience and the read-and-understood records.
import type { FastifyInstance } from 'fastify';
import { maybe, one } from '@veqms/db';
import { DOC_TYPES, ROLES } from '@veqms/domain';
import type { Ctx } from '../app.ts';
import { forbidden, notFound } from '../lib/http.ts';
import { person } from '../lib/people.ts';
import { audit } from '../lib/work.ts';
import { body, need, noContent, number, param, pdf, query, uuid, z } from '../lib/params.ts';
import * as docs from '../services/documents.ts';
import * as env from '../services/envelopes.ts';
import * as training from '../services/training.ts';
import { documentPdf } from '../services/pdf.ts';

const verification = z.object({ footer: z.literal(true), version: z.literal(true), documentId: z.literal(true), dates: z.literal(true), note: z.string().max(1000).optional() });
const audience = z.object({
  groups: z.array(z.string().min(1)).max(100), roles: z.array(z.enum(ROLES)).max(ROLES.length), users: z.array(uuid).max(1000),
  daysToComplete: z.number().int().min(1).max(365), quiz: z.boolean()
});
const block = z.object({ t: z.enum(['h', 'p']), x: z.string().max(20000) });
const p = { number };

export function documentRoutes(api: FastifyInstance, ctx: Ctx): void {
  api.get('/documents', (req) => ctx.run(req, (db, me) => {
    const q = query({ state: z.string().optional(), type: z.string().optional(), q: z.string().max(200).optional() }, req.query);
    return docs.list(db, me, q);
  }));

  api.get('/document-types', async () => DOC_TYPES);

  api.post('/documents', (req) => ctx.run(req, (db, me) => {
    const b = body(z.object({
      docType: z.string(), title: z.string().min(3).max(200), classification: z.enum(['Public', 'Internal', 'Confidential', 'Restricted']),
      ownerId: uuid, process: z.string().min(1).max(100), tags: z.array(z.string().max(40)).max(20).optional(), audience: audience.optional()
    }), req.body);
    return docs.create(db, me, b);
  }));

  api.get('/documents/:number', (req) => ctx.run(req, (db, me) => docs.detail(db, me, param(p, req.params).number, env.latestFor)));

  api.put('/documents/:number/draft', async (req, reply) => {
    const { number: n } = param(p, req.params);
    const b = body(z.object({ content: z.array(block).min(1).max(500), summary: z.string().min(1).max(500) }), req.body);
    await ctx.run(req, (db, me) => docs.saveDraft(db, me, n, b.content, b.summary));
    return noContent(reply);
  });

  api.post('/documents/:number/submit', async (req, reply) => {
    const { number: n } = param(p, req.params);
    const b = body(z.object({ reviewers: z.array(uuid).max(20), approvers: z.array(uuid).min(1).max(2) }), req.body);
    await ctx.run(req, (db, me) => docs.submit(db, me, n, b.reviewers, b.approvers));
    return noContent(reply);
  });

  api.post('/documents/:number/review', async (req, reply) => {
    const { number: n } = param(p, req.params);
    const b = body(z.object({ comment: z.string().max(4000).optional() }), req.body);
    await ctx.run(req, (db, me) => docs.review(db, me, n, b.comment));
    return noContent(reply);
  });

  api.post('/documents/:number/send-back', async (req, reply) => {
    const { number: n } = param(p, req.params);
    const b = body(z.object({ reason: z.string().min(5).max(2000) }), req.body);
    await ctx.run(req, (db, me) => docs.sendBack(db, me, n, b.reason));
    return noContent(reply);
  });

  api.post('/documents/:number/versions', (req) => ctx.run(req, (db, me) => {
    const { number: n } = param(p, req.params);
    const b = body(z.object({ kind: z.enum(['major', 'minor']), summary: z.string().min(3).max(500) }), req.body);
    return docs.newVersion(db, me, n, b.kind, b.summary);
  }));

  // What the envelope will look like before anything is sent: signers in order, problems that block the send, and the allowance.
  api.get('/documents/:number/approval-plan', (req) => ctx.run(req, async (db, me) => {
    const { number: n } = param(p, req.params);
    const q = query({ approvers: z.string().optional() }, req.query);
    const ids = q.approvers ? q.approvers.split(',').filter(Boolean).map((x) => uuid.parse(x)) : undefined;
    const r = await env.planForDocument(db, n, ids);
    await docs.assertVisible(db, me, r.d);
    const name = (id: string) => r.people.find((x) => x.id === id)?.name ?? '';
    return { subject: r.plan.subject, purpose: r.plan.purpose, version: r.v.version, problems: r.plan.problems,
      signers: r.plan.signers.map((s) => ({ ...s, name: name(s.userId), status: 'waiting', signedAt: null })), allowance: await env.allowance(db) };
  }));

  api.post('/documents/:number/envelopes', (req) => ctx.run(req, (db, me) => {
    const { number: n } = param(p, req.params);
    const b = body(z.object({ verification, approvers: z.array(uuid).min(1).max(2) }), req.body);
    return env.sendDocument(db, ctx, me, n, b);
  }));

  api.put('/documents/:number/audience', (req) => ctx.run(req, async (db, me) => {
    const { number: n } = param(p, req.params);
    const b = body(audience, req.body);
    const d = await docs.docByNumber(db, n);
    if (!me.roles.includes('qm') && d.owner_id !== me.id) throw forbidden('Only the document owner or a Quality Manager can change who needs to read it.');
    return training.setAudience(db, me, d.id, b);
  }));

  // The exact PDF that goes into the envelope (footer, version, document ID and signature page), for the verification check.
  api.get('/documents/:number/pdf', async (req, reply) => {
    const { number: n } = param(p, req.params);
    const q = query({ version: z.string().regex(/^\d+\.\d+$/).optional() }, req.query);
    const out = await ctx.run(req, async (db, me) => {
      const d = await docs.docByNumber(db, n);
      await docs.assertVisible(db, me, d);
      const v = q.version
        ? await maybe<docs.VersionRow>(db, 'select * from app.document_versions where document_id = $1 and version = $2', [d.id, q.version])
        : await docs.currentVersion(db, d.id);
      if (!v) throw notFound('That version doesn’t exist.');
      const owner = await person(db, d.owner_id);
      let signers: { name: string; roleLabel: string; meaning: string; anchor: string }[] = [];
      try {
        const plan = await env.planForDocument(db, n);
        signers = plan.plan.signers.map((s, i) => ({ name: plan.people.find((x) => x.id === s.userId)?.name ?? '', roleLabel: s.roleLabel, meaning: s.meaning, anchor: `\\s${i + 1}\\` }));
      } catch { /* no approvers chosen yet: the preview has no signature lines */ }
      await audit(db, 'read', 'Document', d.number, `Opened the PDF of ${d.number} v${v.version}`);
      return { bytes: await documentPdf({ number: d.number, title: d.title, version: v.version, classification: d.classification, owner: owner?.name ?? '', generatedAt: new Date(), blocks: v.content, signers }), name: `${d.number}_v${v.version}.pdf` };
    });
    return pdf(reply, out.bytes, out.name);
  });

  api.get('/documents/:number/training', (req) => ctx.run(req, async (db, me) => {
    const { number: n } = param(p, req.params);
    const q = query({ all: z.string().optional() }, req.query);
    const d = await docs.docByNumber(db, n);
    if (d.owner_id !== me.id) need(me, 'training.org');
    const list = await training.listRecords(db, { documentNumber: n, all: q.all === '1' });
    if (q.all === '1') return list;
    const eff = await maybe<{ version: string }>(db, `select version from app.document_versions where document_id = $1 and state = 'Effective'`, [d.id]);
    return eff ? list.filter((r) => r.version === eff.version) : list;
  }));

  // Questions only: the answers never leave the API.
  api.get('/documents/:number/quiz', (req) => ctx.run(req, async (db) => {
    const d = await docs.docByNumber(db, param(p, req.params).number);
    const enabled = await one<{ training_quiz: boolean }>(db, 'select training_quiz from app.documents where id = $1', [d.id]);
    if (!enabled.training_quiz) return { questions: [] };
    return { questions: (await training.quiz(db, d.id)).map((q) => ({ q: q.question, options: q.options })) };
  }));
}
