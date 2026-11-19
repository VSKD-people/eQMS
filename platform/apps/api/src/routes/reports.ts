// Report exports (Excel and PDF). Each file is stamped with when (UTC) and by whom it was generated, and each export
// is written to the audit trail.
import type { FastifyInstance } from 'fastify';
import { xlsx, utc } from '@veqms/domain';
import type { Db } from '@veqms/db';
import type { Ctx } from '../app.ts';
import { badRequest } from '../lib/http.ts';
import type { Person } from '../lib/people.ts';
import { audit } from '../lib/work.ts';
import { download, need, param, query, z } from '../lib/params.ts';
import * as docs from '../services/documents.ts';
import * as env from '../services/envelopes.ts';
import * as training from '../services/training.ts';
import { tablePdf } from '../services/pdf.ts';

type Cell = string | number | null;
type Q = { group?: string; userId?: string; documentNumber?: string; status?: string; all?: string; year?: number };

const REPORTS: Record<string, { title: string; build: (db: Db, me: Person, q: Q) => Promise<Cell[][]> }> = {
  'training-matrix': {
    title: 'Training matrix',
    async build(db, me, q) {
      need(me, 'training.org');
      const m = await training.matrix(db, q.group);
      const head: Cell[] = ['Person', 'Job title', ...m.documents.map((d) => `${d.number} v${d.currentVersion}`)];
      return [head, ...m.people.map((p) => [p.name, p.jobTitle ?? '', ...m.documents.map((d) => {
        const c = m.cells[p.id]?.[d.id];
        return !c ? '' : c.status === 'Complete' || c.status === 'Superseded' ? `${c.status} (v${c.versionTrained})` : c.status;
      })])];
    }
  },
  'training-records': {
    title: 'Training records',
    async build(db, me, q) {
      if (q.userId !== me.id) need(me, 'training.org');
      const list = await training.listRecords(db, { userId: q.userId, documentNumber: q.documentNumber, status: q.status, all: q.all === '1' });
      return [['Person', 'Document', 'Title', 'Version', 'Status', 'Allocated by', 'Reason', 'Assigned (UTC)', 'Due (UTC)', 'Completed (UTC)', 'Statement', 'Quiz', 'Via', 'Correction of', 'Correction reason'],
        ...list.map((r) => [r.user.name, r.documentNumber, r.title, r.version, r.status, r.allocatedBy?.name ?? 'System', r.allocReason, utc(r.assignedAt), utc(r.dueAt), utc(r.completedAt),
          r.statement ?? '', r.quizResult ?? '', r.via ?? '', r.correctionOf ?? '', r.correctionReason ?? ''])];
    }
  },
  'document-status': {
    title: 'Document status',
    async build(db, me) {
      const list = await docs.list(db, me, {});
      return [['Number', 'Title', 'Type', 'State', 'Classification', 'Owner', 'Current version', 'Effective version', 'Updated (UTC)'],
        ...list.map((d) => [d.number, d.title, d.docType, d.state, d.classification, d.owner.name, d.currentVersion, d.effectiveVersion ?? '', utc(d.updatedAt)])];
    }
  },
  'approvals-register': {
    title: 'Approvals register',
    async build(db, me) {
      need(me, 'approvals.view');
      const list = await env.register(db);
      return [['Record', 'Version', 'Purpose', 'DocuSign envelope ID', 'Sent by', 'Sent (UTC)', 'Completed (UTC)', 'Signers', 'Send no.'],
        ...list.map((e) => [e.recordNumber, e.version ?? '', e.purpose, e.docusignEnvelopeId ?? '', e.sentBy.name, utc(e.sentAt), utc(e.completedAt),
          e.signers.map((s) => `${s.name} (${s.meaning}, ${utc(s.signedAt)})`).join('; '), e.sendNo ? `${e.sendNo}/${e.allowanceYear}` : ''])];
    }
  },
  'docusign-sends': {
    title: 'DocuSign sends',
    async build(db, me, q) {
      need(me, 'approvals.view');
      const list = await env.list(db, { year: q.year });
      return [['Send no.', 'Allowance year', 'Record', 'Version', 'Purpose', 'Status', 'Sent by', 'Sent (UTC)', 'Correction of', 'Reason'],
        ...list.map((e) => [e.sendNo, e.allowanceYear, e.recordNumber, e.version ?? '', e.purpose, e.status, e.sentBy.name, utc(e.sentAt), e.correctionOf ?? '', e.reason ?? ''])];
    }
  }
};

export function reportRoutes(api: FastifyInstance, ctx: Ctx): void {
  api.get('/reports/:file', async (req, reply) => {
    const { file } = param({ file: z.string().regex(/^[a-z-]+\.(xlsx|pdf)$/) }, req.params);
    const [name, format] = file.split('.') as [string, 'xlsx' | 'pdf'];
    const r = REPORTS[name];
    if (!r) throw badRequest(`Unknown report. Choose one of: ${Object.keys(REPORTS).join(', ')}.`);
    const q = query({ group: z.string().max(100).optional(), userId: z.string().uuid().optional(), documentNumber: z.string().max(20).optional(),
      status: z.string().max(20).optional(), all: z.string().optional(), year: z.coerce.number().int().optional() }, req.query);
    const out = await ctx.run(req, async (db, me) => {
      const table = await r.build(db, me, q);
      const at = new Date();
      await audit(db, 'export', 'Report', name, `Exported ${r.title} as ${format.toUpperCase()} (${Math.max(0, table.length - 1)} rows)`, null, { filters: q, format });
      const bytes = format === 'xlsx' ? xlsx(r.title, table, { at, by: me.name }) : await tablePdf(r.title, table, { at, by: me.name });
      return { bytes, name: `${name}_${at.toISOString().slice(0, 10)}.${format}` };
    });
    return download(reply, out.bytes, out.name, format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf');
  });
}
