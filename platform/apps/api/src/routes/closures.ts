// CAPA and deviation closure (Route 1). Phase 1 has the closure path only; the full CAPA and quality event screens
// come in Phase 2 (see BUILD_PROMPT.md).
import type { FastifyInstance } from 'fastify';
import { mapSeq, maybe, rows, type Db } from '@veqms/db';
import type { Ctx } from '../app.ts';
import { conflict, forbidden, notFound } from '../lib/http.ts';
import type { Person } from '../lib/people.ts';
import { addTask, audit, closeTasks, dueIn } from '../lib/work.ts';
import { body, noContent, number, param, pdf, query, uuid, z } from '../lib/params.ts';
import { closurePdf } from '../services/pdf.ts';
import * as signing from '../services/agreements.ts';

const verification = z.object({ footer: z.literal(true), version: z.literal(true), documentId: z.literal(true), dates: z.literal(true), note: z.string().max(1000).optional() });
const p = { number };
const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

type Capa = { id: string; number: string; title: string; state: string; severity: string; owner_id: string; owner_name: string; problem: string; effectiveness_criteria: string;
  effectiveness_result: string | null; effectiveness_verdict: string | null; effectiveness_at: Date | null; closure_agreement_id: string | null; source_event_id: string | null; closed_at: Date | null };
type Qe = { id: string; number: string; type: string; title: string; state: string; severity: string; owner_id: string; owner_name: string; description: string; assessment: string;
  closure_justification: string | null; closure_agreement_id: string | null; closed_at: Date | null };

const CAPA = 'select c.*, u.name as owner_name from app.capas c join app.users u on u.id = c.owner_id';
const QE = 'select q.*, u.name as owner_name from app.quality_events q join app.users u on u.id = q.owner_id';

function owns(me: Person, ownerId: string): void {
  if (ownerId !== me.id && !me.roles.includes('qm')) throw forbidden('Only the owner or a Quality Manager can do this.');
}
async function capa(db: Db, n: string): Promise<Capa> {
  const c = await maybe<Capa>(db, CAPA + ' where c.number = $1', [n]);
  if (!c) throw notFound(`${n} doesn’t exist.`);
  return c;
}
async function qe(db: Db, n: string): Promise<Qe> {
  const q = await maybe<Qe>(db, QE + ' where q.number = $1', [n]);
  if (!q) throw notFound(`${n} doesn’t exist.`);
  return q;
}
const capaApi = async (db: Db, c: Capa) => ({ id: c.id, number: c.number, title: c.title, state: c.state, severity: c.severity, owner: { id: c.owner_id, name: c.owner_name },
  problem: c.problem, effectivenessCriteria: c.effectiveness_criteria, effectivenessResult: c.effectiveness_result, effectivenessVerdict: c.effectiveness_verdict,
  effectivenessAt: iso(c.effectiveness_at), closedAt: iso(c.closed_at), agreement: await signing.latestFor(db, c.id) });
const qeApi = async (db: Db, q: Qe) => ({ id: q.id, number: q.number, type: q.type, title: q.title, state: q.state, severity: q.severity, owner: { id: q.owner_id, name: q.owner_name },
  description: q.description, assessment: q.assessment, closureJustification: q.closure_justification, closedAt: iso(q.closed_at), agreement: await signing.latestFor(db, q.id) });

export async function recordEffectiveness(db: Db, me: Person, n: string, result: string, verdict: 'Effective' | 'Not effective'): Promise<void> {
  const c = await capa(db, n);
  owns(me, c.owner_id);
  if (!['Execution', 'Effectiveness check'].includes(c.state)) throw conflict('Record the effectiveness check once the actions are done.');
  if (c.closure_agreement_id && (await maybe(db, `select 1 from app.agreements where id = $1 and status = 'sent'`, [c.closure_agreement_id]))) throw conflict('The closure is out for signature. Void the agreement to change the result.');
  if (verdict === 'Not effective') {
    await db.query(`update app.capas set effectiveness_result = $2, effectiveness_verdict = $3, effectiveness_by = $4, effectiveness_at = now(), state = 'Execution', actions_locked = false where id = $1`, [c.id, result, verdict, me.id]);
    await audit(db, 'capa.effectiveness', 'CAPA', n, 'Effectiveness check: not effective. Back to execution for more actions.', { state: c.state }, { state: 'Execution', verdict: verdict });
    await closeTasks(db, { recordId: c.id, kinds: ['effectiveness'] });
    await addTask(db, { kind: 'capa-actions', recordType: 'capa', recordId: c.id, recordNumber: n, assigneeId: c.owner_id, dueAt: dueIn(14), note: 'Not effective: plan further actions' });
    return;
  }
  await db.query(`update app.capas set effectiveness_result = $2, effectiveness_verdict = $3, effectiveness_by = $4, effectiveness_at = now(), state = 'Effectiveness check' where id = $1`, [c.id, result, verdict, me.id]);
  await audit(db, 'capa.effectiveness', 'CAPA', n, 'Effectiveness check recorded: effective. Ready to send the closure to Adobe Sign.', { state: c.state, result: c.effectiveness_result }, { state: 'Effectiveness check', result: result, verdict: verdict });
  await closeTasks(db, { recordId: c.id, kinds: ['effectiveness'] });
  await addTask(db, { kind: 'effectiveness', recordType: 'capa', recordId: c.id, recordNumber: n, assigneeId: c.owner_id, dueAt: dueIn(3), note: 'Send the closure for approval in Adobe Sign' });
}

export async function recordClosureJustification(db: Db, me: Person, n: string, justification: string): Promise<void> {
  const q = await qe(db, n);
  owns(me, q.owner_id);
  if (q.type !== 'Deviation') throw conflict('Only deviations close through Adobe Sign.');
  if (!['Open', 'Assessment'].includes(q.state)) throw conflict('This deviation isn’t open.');
  if (q.closure_agreement_id && (await maybe(db, `select 1 from app.agreements where id = $1 and status = 'sent'`, [q.closure_agreement_id]))) throw conflict('The closure is out for signature. Void the agreement to change the justification.');
  await db.query('update app.quality_events set closure_justification = $2 where id = $1', [q.id, justification]);
  await audit(db, 'qe.closure', 'Quality event', n, 'Closure justification recorded (no CAPA needed). Ready to send to Adobe Sign.', { justification: q.closure_justification }, { justification: justification });
}

export function closureRoutes(api: FastifyInstance, ctx: Ctx): void {
  // The closure PDF exactly as it would go into the agreement, for the sender's verification check.
  for (const [path, kind] of [['capas', 'capa'], ['quality-events', 'quality_event']] as const) {
    api.get(`/${path}/:number/pdf`, async (req, reply) => {
      const q = query({ approver: uuid.optional() }, req.query);
      const out = await ctx.run(req, async (db) => {
        const r = await signing.planForClosure(db, kind, param(p, req.params).number, q.approver);
        const signers = r.plan.signers.map((s, i) => ({ name: r.people.find((x) => x.id === s.userId)?.name ?? '', roleLabel: s.roleLabel, meaning: s.meaning, anchor: `\\s${i + 1}\\` }));
        await audit(db, 'read', kind === 'capa' ? 'CAPA' : 'Quality event', r.t.number, `Opened the closure PDF of ${r.t.number}`);
        const bytes = await closurePdf({ number: r.t.number, title: r.t.title, purpose: r.t.purpose, owner: r.people.find((x) => x.id === r.t.ownerId)?.name ?? '', lines: r.t.lines, signers, generatedAt: new Date() });
        return { bytes, name: `${r.t.number}_closure.pdf` };
      });
      return pdf(reply, out.bytes, out.name);
    });
  }

  api.get('/capas', (req) => ctx.run(req, async (db) => mapSeq(await rows<Capa>(db, CAPA + ' order by c.number'), (c) => capaApi(db, c))));
  api.get('/capas/:number', (req) => ctx.run(req, async (db) => capaApi(db, await capa(db, param(p, req.params).number))));

  api.post('/capas/:number/effectiveness', async (req, reply) => {
    const { number: n } = param(p, req.params);
    const b = body(z.object({ result: z.string().min(10).max(4000), verdict: z.enum(['Effective', 'Not effective']) }), req.body);
    await ctx.run(req, (db, me) => recordEffectiveness(db, me, n, b.result, b.verdict));
    return noContent(reply);
  });

  api.get('/capas/:number/approval-plan', (req) => ctx.run(req, async (db) => {
    const q = query({ approver: uuid.optional() }, req.query);
    const r = await signing.planForClosure(db, 'capa', param(p, req.params).number, q.approver);
    await signing.logBlockedPlan(db, r.plan, 'capa', r.t.number);
    return { subject: r.plan.subject, purpose: r.plan.purpose, problems: r.plan.problems, allowance: await signing.allowance(db),
      signers: r.plan.signers.map((s) => ({ ...s, name: r.people.find((x) => x.id === s.userId)?.name ?? '', status: 'waiting', signedAt: null })) };
  }));
  api.post('/capas/:number/agreements', (req) => ctx.run(req, (db, me) => {
    const b = body(z.object({ verification, approverId: uuid }), req.body);
    return signing.sendClosure(db, ctx, me, 'capa', param(p, req.params).number, b);
  }));

  api.get('/quality-events', (req) => ctx.run(req, async (db) => mapSeq(await rows<Qe>(db, QE + ' order by q.number'), (q) => qeApi(db, q))));
  api.get('/quality-events/:number', (req) => ctx.run(req, async (db) => qeApi(db, await qe(db, param(p, req.params).number))));

  api.post('/quality-events/:number/closure', async (req, reply) => {
    const { number: n } = param(p, req.params);
    const b = body(z.object({ justification: z.string().min(10).max(4000) }), req.body);
    await ctx.run(req, (db, me) => recordClosureJustification(db, me, n, b.justification));
    return noContent(reply);
  });
  api.get('/quality-events/:number/approval-plan', (req) => ctx.run(req, async (db) => {
    const q = query({ approver: uuid.optional() }, req.query);
    const r = await signing.planForClosure(db, 'quality_event', param(p, req.params).number, q.approver);
    await signing.logBlockedPlan(db, r.plan, 'quality_event', r.t.number);
    return { subject: r.plan.subject, purpose: r.plan.purpose, problems: r.plan.problems, allowance: await signing.allowance(db),
      signers: r.plan.signers.map((s) => ({ ...s, name: r.people.find((x) => x.id === s.userId)?.name ?? '', status: 'waiting', signedAt: null })) };
  }));
  api.post('/quality-events/:number/agreements', (req) => ctx.run(req, (db, me) => {
    const b = body(z.object({ verification, approverId: uuid }), req.body);
    return signing.sendClosure(db, ctx, me, 'quality_event', param(p, req.params).number, b);
  }));
}
