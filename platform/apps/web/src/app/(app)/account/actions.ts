'use server';
import { redirect } from 'next/navigation';
import { api, errorMessage, str } from '@/lib/api';
import { getSession, setSession } from '@/lib/session';
import { safeNext } from '@/lib/oidc';
import { withMsg } from '@/lib/actions';

// The API checks the current password and the password rule, ends the other sessions, and returns a new token for
// this one.
export async function changePassword(next: string, fd: FormData) {
  const page = `/account/password?next=${encodeURIComponent(next)}`;
  const n = str(fd, 'next');
  if (n !== str(fd, 'again')) redirect(withMsg(page, 'err', 'The two new passwords don’t match.'));
  let t: { token: string; expiresAt: number } | null = null; let err = '';
  try { t = await api<{ token: string; expiresAt: number }>('/auth/password', { method: 'POST', body: { current: str(fd, 'current'), next: n } }); } catch (e) { err = errorMessage(e); }
  if (!t) redirect(withMsg(page, 'err', err));
  const s = await getSession();
  await setSession({ ...(s ?? {}), local: true, accessToken: t.token, expiresAt: t.expiresAt, mustChange: false });
  redirect(withMsg(safeNext(next), 'ok', 'Password changed.'));
}
