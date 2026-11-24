'use server';
import { redirect } from 'next/navigation';
import { str } from '@/lib/api';
import { mutate, withMsg } from '@/lib/actions';

// Bound arguments come back from the browser, so only accept a path inside this app.
function inApp(back: string): string {
  return back.startsWith('/') && !back.startsWith('//') ? back : '/approvals';
}

export async function cancelFromDetails(id: string, fd: FormData) {
  const reason = str(fd, 'reason');
  if (!reason) redirect(withMsg(`/approvals/${id}`, 'err', 'Give a reason for cancelling.'));
  await mutate(`/agreements/${id}/cancel`, { method: 'POST', body: { reason } }, `/approvals/${id}`, 'Agreement cancelled. The record is back with its owner; a corrected agreement is a new send.');
}

export async function refreshStatus(id: string) {
  await mutate(`/agreements/${id}/refresh`, { method: 'POST' }, `/approvals/${id}`, 'Status checked with Adobe Sign.');
}

// Development only (Adobe Sign mock mode). The API refuses both with 403 when Adobe Sign is live.
export async function mockSign(id: string, back: string) {
  const to = inApp(back);
  await mutate(`/agreements/${id}/mock/sign`, { method: 'POST' }, to, 'Signed (mock Adobe Sign). The agreement goes to the next signer, or completes if you were the last.');
}

export async function mockDecline(id: string, back: string, fd: FormData) {
  const to = inApp(back);
  const reason = str(fd, 'reason');
  if (!reason) redirect(withMsg(to, 'err', 'Give a reason for declining.'));
  await mutate(`/agreements/${id}/mock/decline`, { method: 'POST', body: { reason } }, to, 'Declined (mock Adobe Sign). The record goes back to its owner with your reason.');
}
