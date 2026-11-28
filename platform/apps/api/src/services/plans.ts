// Signing plans, shared by the document workflow (documents.ts) and the agreements service (agreements.ts), which
// don't import each other: who signs in what order, the segregation-of-duties checks, and the document PDF with a
// signature field for each signer.
import { rows, type Db } from '@veqms/db';
import { planDocumentAgreement, signatureTag, type SigningPlan } from '@veqms/domain';
import { badRequest, conflict, logged } from '../lib/http.ts';
import { people, person, type Person } from '../lib/people.ts';
import { audit } from '../lib/work.ts';
import { documentPdf, type SignerLine } from './pdf.ts';
import type { Block } from './documents.ts';

export type RecordType = 'document' | 'capa' | 'quality_event';
export const LABEL: Record<RecordType, string> = { document: 'Document', capa: 'CAPA', quality_event: 'Quality event' };

// The segregation-of-duties problem in a plan, if there is one (author, reviewer or owner as their own approver).
export function sodProblem(plan: SigningPlan): string | undefined {
  return plan.problems.find((p) => /segregation of duties|can’t also|can’t approve/.test(p));
}

// Showing someone a plan they can't go ahead with because of segregation of duties is logged like a refusal: the
// screens disable the button, so without this the block would never reach the audit trail.
export async function logBlockedPlan(db: Db, plan: SigningPlan, recordType: RecordType, recordNumber: string): Promise<void> {
  const sod = sodProblem(plan);
  if (sod) await audit(db, 'sod.block', LABEL[recordType], recordNumber, 'Send page shown with sending blocked: ' + sod);
}

// Refuse a plan with problems. A segregation-of-duties refusal reaches the audit trail even though the request rolls back.
export async function checkPlan(db: Db, plan: SigningPlan, recordType: RecordType, recordNumber: string, what = 'Adobe Sign agreement not sent (blocked)'): Promise<void> {
  if (!plan.problems.length) return;
  const e = conflict(plan.problems[0]!);
  const sod = sodProblem(plan);
  throw sod ? logged(e, { action: 'sod.block', objectType: LABEL[recordType], objectId: recordNumber, summary: `${what}: ${sod}` }) : e;
}

type DocLike = { id: string; number: string; title: string; author_id: string; owner_id: string; classification: string };

// A document version's signing plan: author, then reviewers (in parallel), then the QA approvers. Reviewers and
// approvers come from the document unless the submit form is choosing them.
export async function documentPlan(db: Db, d: DocLike, version: string, choose?: { reviewers?: string[]; approvers?: string[] }) {
  const rv = choose?.reviewers ?? (await rows<{ user_id: string }>(db, 'select user_id from app.document_reviewers where document_id = $1', [d.id])).map((r) => r.user_id);
  const ap = choose?.approvers ?? (await rows<{ user_id: string }>(db, 'select user_id from app.document_approvers where document_id = $1 order by position', [d.id])).map((r) => r.user_id);
  const ps = await people(db, [d.author_id, ...rv, ...ap]);
  const get = (id: string): Person => { const p = ps.find((x) => x.id === id); if (!p) throw badRequest('Unknown person in the signing order.'); return p; };
  const plan = planDocumentAgreement({ documentNumber: d.number, title: d.title, version, author: get(d.author_id), reviewers: [...new Set(rv)].map(get), approvers: ap.map(get) });
  return { plan, people: ps };
}

// The document PDF with a signature field (an Adobe Sign text tag) under each signer's line. At submit this is the
// PDF that is locked: reviewed, approved, signed and published exactly as it is.
export async function renderDocumentPdf(db: Db, d: DocLike, v: { version: string; content: Block[] }, plan: SigningPlan | null, ps: Person[]): Promise<Uint8Array> {
  const owner = await person(db, d.owner_id);
  return documentPdf({ number: d.number, title: d.title, version: v.version, classification: d.classification, owner: owner?.name ?? '', generatedAt: new Date(), blocks: v.content, signers: signerLines(plan, ps) });
}

// One line per signer on the signature page, each with its Adobe Sign text tag.
export function signerLines(plan: SigningPlan | null, ps: Person[]): SignerLine[] {
  return (plan?.signers ?? []).map((s, i) => ({ name: ps.find((p) => p.id === s.userId)?.name ?? '', roleLabel: s.roleLabel, meaning: s.meaning, anchor: signatureTag(i + 1) }));
}
