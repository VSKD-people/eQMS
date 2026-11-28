'use server';
import { redirect } from 'next/navigation';
import { bool, str } from '@/lib/api';
import { mutate, withMsg } from '@/lib/actions';

export async function openRecord(fd: FormData) {
  const n = str(fd, 'number').toUpperCase();
  if (/^CAPA-\d+$/.test(n)) redirect(`/quality/capas/${n}`);
  if (/^QE-\d+$/.test(n)) redirect(`/quality/events/${n}`);
  redirect(withMsg('/quality', 'err', 'Enter a CAPA or quality event number, such as CAPA-005 or QE-017.'));
}

export async function recordEffectiveness(number: string, fd: FormData) {
  const result = str(fd, 'result');
  if (!result) redirect(withMsg(`/quality/capas/${number}`, 'err', 'Describe the result.'));
  await mutate(`/capas/${number}/effectiveness`, { method: 'POST', body: { result, verdict: str(fd, 'verdict') === 'Not effective' ? 'Not effective' : 'Effective' } },
    `/quality/capas/${number}`, 'Result recorded. Now verify the closure PDF and send it to Adobe Sign.');
}

export async function writeJustification(number: string, fd: FormData) {
  const justification = str(fd, 'justification');
  if (justification.length < 15) redirect(withMsg(`/quality/events/${number}`, 'err', 'Write a justification of at least a sentence.'));
  await mutate(`/quality-events/${number}/closure`, { method: 'POST', body: { justification } }, `/quality/events/${number}`, 'Justification saved. Now verify the closure PDF and send it to Adobe Sign.');
}

function verification(fd: FormData) {
  return { footer: bool(fd, 'footer'), version: bool(fd, 'version'), documentId: bool(fd, 'documentId'), dates: bool(fd, 'dates'), note: str(fd, 'note') };
}

export async function sendClosure(kind: 'capas' | 'quality-events', number: string, approverId: string, fd: FormData) {
  const page = kind === 'capas' ? `/quality/capas/${number}` : `/quality/events/${number}`;
  const v = verification(fd);
  if (!(v.footer && v.version && v.documentId && v.dates)) redirect(withMsg(`${page}?a0=${approverId}`, 'err', 'Tick all four verification checks before sending.'));
  await mutate(`/${kind}/${number}/agreements`, { method: 'POST', body: { verification: v, approverId } }, page, 'Closure sent to Adobe Sign. The owner signs first, then the QA approver.', `${page}?a0=${approverId}`);
}
