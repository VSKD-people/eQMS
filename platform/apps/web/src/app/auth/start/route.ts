import { NextResponse, type NextRequest } from 'next/server';
import { newLogin } from '@/lib/oidc';
import { env } from '@/lib/env';

// Starts Microsoft sign-in. The PKCE verifier, state and nonce wait in a short-lived httpOnly cookie.
export async function GET(req: NextRequest) {
  const { url, pending } = newLogin(req.nextUrl.searchParams.get('next') ?? '/today');
  const res = NextResponse.redirect(url);
  res.cookies.set('veqms_login', JSON.stringify(pending), { httpOnly: true, secure: env.production, sameSite: 'lax', path: '/auth', maxAge: 600 });
  return res;
}
