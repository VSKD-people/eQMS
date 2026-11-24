// Read-and-understood training (Route 2). The trainee confirms their own record; the system sets the dates; a
// completed record is never edited (corrections are new records). The database enforces all three.
import type { FastifyInstance } from 'fastify';
import { mapSeq, rows } from '@veqms/db';
import type { Ctx } from '../app.ts';
import { forbidden } from '../lib/http.ts';
import { body, need, param, query, uuid, z } from '../lib/params.ts';
import * as training from '../services/training.ts';

const id = { id: uuid };
const CLOSED = ['Superseded', 'Withdrawn', 'Corrected', 'Correction', 'Obsolete', 'Complete'];

export function trainingRoutes(api: FastifyInstance, ctx: Ctx): void {
  api.get('/training/my', (req) => ctx.run(req, async (db, me) => {
    const all = await training.listRecords(db, { userId: me.id, all: true });
    return { open: all.filter((r) => r.status === 'Assigned' || r.status === 'Overdue'), history: all.filter((r) => CLOSED.includes(r.status)) };
  }));

  api.post('/training/records/:id/complete', (req) => ctx.run(req, (db, me, auth) => {
    const b = body(z.object({ confirm: z.literal(true), quizAnswers: z.array(z.number().int().min(0).max(9)).max(50).optional() }), req.body);
    return training.complete(db, me, auth.via, param(id, req.params).id, b.quizAnswers);
  }));

  api.get('/training/records', (req) => ctx.run(req, (db, me) => {
    const q = query({ userId: uuid.optional(), documentNumber: z.string().max(20).optional(), status: z.string().max(20).optional(), all: z.string().optional() }, req.query);
    if (q.userId !== me.id) need(me, 'training.org');
    return training.listRecords(db, { userId: q.userId, documentNumber: q.documentNumber, status: q.status, all: q.all === '1' });
  }));

  api.get('/training/records/:id', (req) => ctx.run(req, async (db, me) => {
    const rid = param(id, req.params).id;
    const r = await training.getRecord(db, rid);
    if (r.user_id !== me.id) need(me, 'training.org');
    const corrections = await rows<{ id: string }>(db, 'select id from app.training_records where correction_of = $1 order by assigned_at', [rid]);
    const audit = await rows<{ seq: string; at: Date; actor_label: string; action: string; summary: string; before: unknown; after: unknown }>(db,
      `select seq, at, actor_label, action, summary, before, after from app.audit_log where object_type = 'Training record' and object_id = $1 order by seq`, [rid]);
    return {
      record: training.toApi(r),
      corrections: await mapSeq(corrections, async (c) => training.toApi(await training.getRecord(db, c.id))),
      audit: audit.map((a) => ({ seq: Number(a.seq), at: new Date(a.at).toISOString(), actor: a.actor_label, action: a.action, objectType: 'Training record', objectId: rid, summary: a.summary, before: a.before, after: a.after }))
    };
  }));

  api.post('/training/records/:id/corrections', (req) => ctx.run(req, (db, me) => {
    if (!me.roles.includes('qm')) throw forbidden('Only a Quality Manager can correct a training record.');
    const b = body(z.object({ reason: z.string().min(10).max(2000), retrain: z.boolean() }), req.body);
    return training.correct(db, me, param(id, req.params).id, b.reason, b.retrain);
  }));

  api.get('/training/matrix', (req) => ctx.run(req, (db, me) => {
    need(me, 'training.org');
    const q = query({ group: z.string().max(100).optional() }, req.query);
    return training.matrix(db, q.group);
  }));

  api.post('/training/reminders', (req) => ctx.run(req, (db, me) => {
    need(me, 'training.manage');
    return training.reminders(db);
  }));
}
