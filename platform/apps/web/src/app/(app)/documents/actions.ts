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

// Submit, step 1: choose the people; the draft is converted to PDF, hashed and locked.
export async function preparePdf(number: string, fd: FormData) {
  const page = `/documents/${number}/submit`;
  const approvers = [str(fd, 'a1'), str(fd, 'a2')].filter(Boolean);
  if (!approvers.length) redirect(withMsg(page, 'err', 'Choose a QA approver.'));
  if (approvers.length === 2 && approvers[0] === approvers[1]) redirect(withMsg(page, 'err', 'Choose two different QA approvers.'));
  await mutate(`/documents/${number}/pdf`, { method: 'POST', body: { reviewers: list(fd, 'reviewers'), approvers } }, page, 'PDF made and locked. Open it, make the four checks, then submit.', page);
}

// Submit, step 2: the four checks on the locked PDF the author was shown (sha256 identifies it).
// Live SharePoint: the text is in Word, so only the change summary is saved here.
export async function saveSummary(number: string, fd: FormData) {
  const summary = str(fd, 'summary');
  if (!summary) redirect(withMsg(`/documents/${number}/edit`, 'err', 'A change summary is required for every version.'));
  await mutate(`/documents/${number}/draft`, { method: 'PUT', body: { summary } }, `/documents/${number}`, 'Change summary saved.', `/documents/${number}/edit`);
}

export async function submitForReview(number: string, sha256: string, fd: FormData) {
  const page = `/documents/${number}/submit`;
  const v = { footer: bool(fd, 'footer'), version: bool(fd, 'version'), documentId: bool(fd, 'documentId'), dates: bool(fd, 'dates'), note: str(fd, 'note') };
  if (!(v.footer && v.version && v.documentId && v.dates)) redirect(withMsg(page, 'err', 'Tick all four checks before submitting.'));
  await mutate(`/documents/${number}/submit`, { method: 'POST', body: { verification: v, pdfSha256: sha256 } }, `/documents/${number}`, 'Submitted. Reviewers have been told.', page);
}

// A QA approver approves in VeQMS. Retraining is the default; "no retraining" needs a reason.
export async function approveDocument(number: string, fd: FormData) {
  const retrain = str(fd, 'retrain') !== 'no';
  const reason = str(fd, 'reason');
  if (!retrain && reason.length < 10) redirect(withMsg(`/documents/${number}`, 'err', 'Say why no retraining is needed.'));
  await mutate(`/documents/${number}/approve`, { method: 'POST', body: { retrain, reason: retrain ? undefined : reason, comment: str(fd, 'comment') || undefined } }, `/documents/${number}`,
    'Approved. If you were the last QA approver, the agreement has gone to Adobe Sign with every signer.');
}

export async function markReviewed(number: string, fd: FormData) {
  await mutate(`/documents/${number}/review`, { method: 'POST', body: { comment: str(fd, 'comment') || undefined } }, `/documents/${number}`, 'Marked reviewed.');
}

export async function sendBack(number: string, fd: FormData) {
  const reason = str(fd, 'reason');
  if (!reason) redirect(withMsg(`/documents/${number}`, 'err', 'Give a reason so the author knows what to fix.'));
  await mutate(`/documents/${number}/send-back`, { method: 'POST', body: { reason } }, `/documents/${number}`, 'Returned to the author.');
}

export async function newVersion(number: string, fd: FormData) {
  const summary = str(fd, 'summary');
  if (!summary) redirect(withMsg(`/documents/${number}`, 'err', 'Say why the document is changing.'));
  await mutate(`/documents/${number}/versions`, { method: 'POST', body: { kind: str(fd, 'kind') === 'minor' ? 'minor' : 'major', summary } }, `/documents/${number}/edit`, 'New draft version started.', `/documents/${number}`);
}

export async function cancelAgreement(number: string, agreementId: string, fd: FormData) {
  const reason = str(fd, 'reason');
  if (!reason) redirect(withMsg(`/documents/${number}?tab=approval`, 'err', 'Give a reason for cancelling.'));
  await mutate(`/agreements/${agreementId}/cancel`, { method: 'POST', body: { reason } }, `/documents/${number}?tab=approval`, 'Agreement cancelled. The document is back with its author, and goes through review and approval again.');
}

export async function changeAudience(number: string, fd: FormData) {
  await mutate(`/documents/${number}/audience`, { method: 'PUT', body: audience(fd) }, `/documents/${number}?tab=training`, 'Audience saved. New members have been allocated the effective version.');
}
