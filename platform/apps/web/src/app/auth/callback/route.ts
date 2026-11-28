import { NextResponse, type NextRequest } from 'next/server';
import { completeLogin, safeNext, type PendingLogin } from '@/lib/oidc';
import { setSession } from '@/lib/session';
import { env } from '@/lib/env';

export async function GET(req: NextRequest) {
  const fail = (msg: string) => NextResponse.redirect(`${env.appBaseUrl}/login?err=${encodeURIComponent(msg)}`);
  const raw = req.cookies.get('veqms_login')?.value;
  if (!raw) return fail('Sign-in took too long. Please try again.');
  let pending: PendingLogin;
  try { pending = JSON.parse(raw) as PendingLogin; } catch { return fail('Sign-in failed. Please try again.'); }
  const p = req.nextUrl.searchParams;
  if (p.get('error')) return fail(p.get('error_description') ?? 'Microsoft sign-in was cancelled.');
  if (!p.get('code') || p.get('state') !== pending.state) return fail('Sign-in check failed (state). Please try again.');
  try {
    const session = await completeLogin(p.get('code') as string, pending);
    await setSession(session);
  } catch (e) {
    return fail((e as Error).message);
  }
  const res = NextResponse.redirect(`${env.appBaseUrl}${safeNext(pending.next)}`);
  res.cookies.delete({ name: 'veqms_login', path: '/auth' });
  return res;
}
