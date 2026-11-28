'use server';
import { redirect } from 'next/navigation';
import { setSession } from '@/lib/session';
import { env } from '@/lib/env';
import { safeNext } from '@/lib/oidc';
import { clientHeaders } from '@/lib/api';

const PERSONAS = ['dev-vic', 'dev-tom', 'dev-sam', 'dev-priya', 'dev-grace', 'dev-daniel', 'dev-hannah', 'dev-aud', 'dev-omar', 'dev-mia', 'dev-lena', 'dev-jake'];

// Email and password sign-in (AUTH_MODE=local). The API checks the password, counts failures, and returns its own
// session token; the browser never sees the API.
export async function localSignIn(fd: FormData) {
  const next = safeNext(String(fd.get('next') ?? '/today'));
  if (env.authMode !== 'local') redirect('/login?err=' + encodeURIComponent('Sign in with Microsoft.'));
  const back = (msg: string) => redirect(`/login?next=${encodeURIComponent(next)}&err=${encodeURIComponent(msg)}`);
  let r: Response;
  try {
    r = await fetch(`${env.apiBaseUrl}/auth/local/login`, {
      method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(await clientHeaders()) },
      body: JSON.stringify({ email: String(fd.get('email') ?? ''), password: String(fd.get('password') ?? '') })
    });
  } catch {
    return back('VeQMS can’t be reached just now. Try again in a minute.');
  }
  const data = (await r.json().catch(() => ({}))) as { token?: string; expiresAt?: number; mustChange?: boolean; name?: string; email?: string; error?: { message?: string } };
  if (!r.ok || !data.token) return back(data.error?.message ?? 'Couldn’t sign you in.');
  await setSession({ local: true, accessToken: data.token, expiresAt: data.expiresAt, mustChange: !!data.mustChange, name: data.name, email: data.email });
  redirect(data.mustChange ? `/account/password?next=${encodeURIComponent(next)}` : next);
}

// Development only: sign in as a seeded persona. The API also refuses X-Dev-User in production.
export async function devSignIn(fd: FormData) {
  if (!env.devAuth) redirect('/login?err=' + encodeURIComponent('Demo sign-in is switched off.'));
  const who = String(fd.get('persona') ?? '');
  if (!PERSONAS.includes(who)) redirect('/login?err=' + encodeURIComponent('Pick a persona.'));
  await setSession({ devUser: who });
  redirect(safeNext(String(fd.get('next') ?? '/today')));
}
