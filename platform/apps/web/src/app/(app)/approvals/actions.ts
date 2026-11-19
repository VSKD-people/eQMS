'use server';
import { redirect } from 'next/navigation';
import { str } from '@/lib/api';
import { mutate, withMsg } from '@/lib/actions';

// Bound arguments come back from the browser, so only accept a path inside this app.
function inApp(back: string): string {
  return back.startsWith('/') && !back.startsWith('//') ? back : '/approvals';
}

export async function voidFromDetails(id: string, fd: FormData) {
  const reason = str(fd, 'reason');
  if (!reason) redirect(withMsg(`/approvals/${id}`, 'err', 'Give a reason for voiding.'));
  await mutate(`/envelopes/${id}/void`, { method: 'POST', body: { reason } }, `/approvals/${id}`, 'Envelope voided. The record is back with its owner; a corrected envelope is a new send.');
}

export async function refreshStatus(id: string) {
  await mutate(`/envelopes/${id}/refresh`, { method: 'POST' }, `/approvals/${id}`, 'Status checked with DocuSign.');
}

// Development only (DocuSign mock mode). The API refuses both with 403 when DocuSign is live.
export async function mockSign(id: string, back: string) {
  const to = inApp(back);
  await mutate(`/envelopes/${id}/mock/sign`, { method: 'POST' }, to, 'Signed (mock DocuSign). The next signer is up.');
}

export async function mockDecline(id: string, back: string, fd: FormData) {
  const to = inApp(back);
  const reason = str(fd, 'reason');
  if (!reason) redirect(withMsg(to, 'err', 'Give a reason for declining.'));
  await mutate(`/envelopes/${id}/mock/decline`, { method: 'POST', body: { reason } }, to, 'Declined (mock DocuSign). The record goes back to its owner with your reason.');
}
