'use server';
import { redirect } from 'next/navigation';
import { api, errorMessage, list, str, bool } from '@/lib/api';
import { mutate, withMsg } from '@/lib/actions';

// Turn the plain-text editor back into blocks: lines starting "## " are headings, blank lines split paragraphs.
function toBlocks(text: string): { t: 'h' | 'p'; x: string }[] {
  return text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).map((s) => (s.startsWith('## ') ? { t: 'h' as const, x: s.slice(3).trim() } : { t: 'p' as const, x: s.replace(/\n/g, ' ') }));
}
function audience(fd: FormData) {
  return { groups: list(fd, 'groups'), roles: list(fd, 'roles'), users: list(fd, 'users'), daysToComplete: Math.max(1, Number(str(fd, 'days')) || 14), quiz: bool(fd, 'quiz') };
}

export async function createDocument(fd: FormData) {
  const body = { docType: str(fd, 'docType'), title: str(fd, 'title'), classification: str(fd, 'classification'), ownerId: str(fd, 'ownerId'), process: str(fd, 'process'),
    tags: str(fd, 'tags').split(',').map((t) => t.trim()).filter(Boolean), audience: audience(fd) };
  if (!body.title) redirect(withMsg('/documents/new', 'err', 'Give the document a title.'));
  let made: { id: string; number: string } | null = null; let err = '';
  try { made = await api<{ id: string; number: string }>('/documents', { method: 'POST', body }); } catch (e) { err = errorMessage(e); }
  if (!made) redirect(withMsg('/documents/new', 'err', err));
  redirect(withMsg(`/documents/${made.number}/edit`, 'ok', `${made.number} created as a draft. Write it, then submit it for review.`));
}

export async function saveDraft(number: string, fd: FormData) {
  const summary = str(fd, 'summary');
  const content = toBlocks(String(fd.get('content') ?? ''));
  if (!summary) redirect(withMsg(`/documents/${number}/edit`, 'err', 'A change summary is required for every version.'));
  if (!content.length) redirect(withMsg(`/documents/${number}/edit`, 'err', 'The document can’t be empty.'));
  await mutate(`/documents/${number}/draft`, { method: 'PUT', body: { content, summary } }, `/documents/${number}`, 'Draft saved.', `/documents/${number}/edit`);
}

export async function submitForReview(number: string, fd: FormData) {
  const approvers = [str(fd, 'a1'), str(fd, 'a2')].filter(Boolean);
  if (approvers.length === 2 && approvers[0] === approvers[1]) redirect(withMsg(`/documents/${number}/submit`, 'err', 'Choose two different QA approvers.'));
  await mutate(`/documents/${number}/submit`, { method: 'POST', body: { reviewers: list(fd, 'reviewers'), approvers } }, `/documents/${number}`, 'Submitted. Reviewers have been told.', `/documents/${number}/submit`);
}

export async function markReviewed(number: string, fd: FormData) {
  await mutate(`/documents/${number}/review`, { method: 'POST', body: { comment: str(fd, 'comment') || undefined } }, `/documents/${number}`, 'Marked reviewed.');
}

export async function sendBack(number: string, fd: FormData) {
  const reason = str(fd, 'reason');
  if (!reason) redirect(withMsg(`/documents/${number}`, 'err', 'Give a reason so the author knows what to fix.'));
  await mutate(`/documents/${number}/send-back`, { method: 'POST', body: { reason } }, `/documents/${number}`, 'Sent back to draft.');
}

export async function newVersion(number: string, fd: FormData) {
  const summary = str(fd, 'summary');
  if (!summary) redirect(withMsg(`/documents/${number}`, 'err', 'Say why the document is changing.'));
  await mutate(`/documents/${number}/versions`, { method: 'POST', body: { kind: str(fd, 'kind') === 'minor' ? 'minor' : 'major', summary } }, `/documents/${number}/edit`, 'New draft version started.', `/documents/${number}`);
}

export async function sendEnvelope(number: string, approvers: string[], fd: FormData) {
  const back = `/documents/${number}/send?approvers=${encodeURIComponent(approvers.join(','))}`;
  const v = { footer: bool(fd, 'footer'), version: bool(fd, 'version'), documentId: bool(fd, 'documentId'), dates: bool(fd, 'dates'), note: str(fd, 'note') };
  if (!(v.footer && v.version && v.documentId && v.dates)) redirect(withMsg(back, 'err', 'Tick all four verification checks before sending.'));
  await mutate(`/documents/${number}/envelopes`, { method: 'POST', body: { verification: v, approvers } }, `/documents/${number}?tab=approval`, 'Sent to DocuSign. The author signs first; DocuSign emails each signer in turn.', back);
}

export async function voidEnvelope(number: string, envelopeId: string, fd: FormData) {
  const reason = str(fd, 'reason');
  if (!reason) redirect(withMsg(`/documents/${number}?tab=approval`, 'err', 'Give a reason for voiding.'));
  await mutate(`/envelopes/${envelopeId}/void`, { method: 'POST', body: { reason } }, `/documents/${number}?tab=approval`, 'Envelope voided. The document is back in draft; a corrected envelope is a new send.');
}

export async function changeAudience(number: string, fd: FormData) {
  await mutate(`/documents/${number}/audience`, { method: 'PUT', body: audience(fd) }, `/documents/${number}?tab=training`, 'Audience saved. New members have been allocated the effective version.');
}
