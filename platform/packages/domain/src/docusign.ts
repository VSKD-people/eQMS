// Route 1: approvals through DocuSign (Part 11 module).
// One envelope per record version holds every signer: author, then reviewers, then QA approver(s).
// Pure functions only: the API loads the people and passes them in.
import type { Meaning, PlannedSigner, UserRef } from './types.ts';
import { canBeApprover } from './permissions.ts';

export interface DocumentEnvelopeInput {
  documentNumber: string;
  title: string;
  version: string;
  author: UserRef;
  reviewers: UserRef[];
  approvers: UserRef[]; // QA approvers, in signing order (1 or 2)
}

export interface ClosureEnvelopeInput {
  recordNumber: string; // e.g. CAPA-005 or QE-017
  title: string;
  purpose: 'CAPA closure' | 'Deviation closure';
  owner: UserRef;
  approver: UserRef | null;
  hasClosureText: boolean;
}

export interface EnvelopePlan {
  subject: string;
  purpose: string;
  signers: PlannedSigner[];
  problems: string[];
}

export const MAX_SUBJECT = 100; // DocuSign limits the email subject length; verify the current limit in the DocuSign docs.

export function documentSubject(documentNumber: string, version: string, title: string): string {
  const s = `${documentNumber} v${version} · ${title} · Approval`;
  return s.length <= MAX_SUBJECT ? s : `${documentNumber} v${version} · Approval`;
}

function activeProblems(signers: { user: UserRef; label: string }[]): string[] {
  return signers.filter((s) => s.user.status !== 'active').map((s) => `${s.user.name} (${s.label.toLowerCase()}) is not an active user.`);
}

export function planDocumentEnvelope(i: DocumentEnvelopeInput): EnvelopePlan {
  const problems: string[] = [];
  const signers: PlannedSigner[] = [{ userId: i.author.id, roleLabel: 'Author', meaning: 'Authored', routingOrder: 1 }];
  for (const r of i.reviewers) signers.push({ userId: r.id, roleLabel: 'Reviewer', meaning: 'Reviewed', routingOrder: 2 });
  const base = i.reviewers.length ? 3 : 2;
  i.approvers.forEach((a, idx) => signers.push({ userId: a.id, roleLabel: i.approvers.length > 1 ? `QA approver ${idx + 1}` : 'QA approver', meaning: 'Approved', routingOrder: base + idx }));

  if (!i.approvers.length) problems.push('Choose a QA approver.');
  if (i.approvers.length > 2) problems.push('A document can have at most two QA approvers.');
  if (new Set(i.approvers.map((a) => a.id)).size !== i.approvers.length) problems.push('Choose two different QA approvers.');
  for (const a of i.approvers) {
    if (a.id === i.author.id) problems.push(`${a.name} authored this version, so they can’t approve it (segregation of duties). Choose another QA approver.`);
    if (i.reviewers.some((r) => r.id === a.id)) problems.push(`${a.name} is a reviewer, so they can’t also be the QA approver.`);
    if (!canBeApprover(a.roles)) problems.push(`${a.name} doesn’t hold the Approver or Quality Manager role.`);
  }
  problems.push(...activeProblems([{ user: i.author, label: 'Author' }, ...i.reviewers.map((u) => ({ user: u, label: 'Reviewer' })), ...i.approvers.map((u) => ({ user: u, label: 'QA approver' }))]));
  return { subject: documentSubject(i.documentNumber, i.version, i.title), purpose: 'Document approval', signers, problems };
}

export function planClosureEnvelope(i: ClosureEnvelopeInput): EnvelopePlan {
  const problems: string[] = [];
  const signers: PlannedSigner[] = [{ userId: i.owner.id, roleLabel: i.purpose === 'CAPA closure' ? 'CAPA owner' : 'Deviation owner', meaning: 'Authored', routingOrder: 1 }];
  if (!i.approver) problems.push('Choose a QA approver.');
  else {
    signers.push({ userId: i.approver.id, roleLabel: 'QA approver', meaning: 'Approved', routingOrder: 2 });
    if (i.approver.id === i.owner.id) problems.push(`${i.approver.name} owns this record, so they can’t also approve its closure.`);
    if (!canBeApprover(i.approver.roles)) problems.push(`${i.approver.name} doesn’t hold the Approver or Quality Manager role.`);
  }
  if (!i.hasClosureText) problems.push(i.purpose === 'CAPA closure' ? 'Record the effectiveness result first.' : 'Write the closure justification first.');
  problems.push(...activeProblems([{ user: i.owner, label: 'Owner' }, ...(i.approver ? [{ user: i.approver, label: 'QA approver' }] : [])]));
  let subject = `${i.recordNumber} · ${i.title} · ${i.purpose}`;
  if (subject.length > MAX_SUBJECT) subject = `${i.recordNumber} · ${i.purpose}`;
  return { subject, purpose: i.purpose, signers, problems };
}

// The verification check the sender must complete before an envelope can go out.
export interface Verification { footer: boolean; version: boolean; documentId: boolean; dates: boolean; note?: string }
export function verificationComplete(v: Partial<Verification> | null | undefined): boolean {
  return !!(v && v.footer === true && v.version === true && v.documentId === true && v.dates === true);
}

// Which routing order is current: the lowest order with anyone not yet signed. null means everyone has signed.
export function currentOrder(signers: { routingOrder: number; status: string }[]): number | null {
  const open = signers.filter((s) => s.status !== 'signed');
  return open.length ? Math.min(...open.map((s) => s.routingOrder)) : null;
}

export const MEANING_ORDER: Meaning[] = ['Authored', 'Reviewed', 'Approved'];
