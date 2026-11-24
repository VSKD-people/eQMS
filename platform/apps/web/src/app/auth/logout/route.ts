import { NextResponse, type NextRequest } from 'next/server';
import { clearSession, getSession } from '@/lib/session';
import { logoutUrl } from '@/lib/oidc';
import { env } from '@/lib/env';

// Fixed messages only: the reason is a code, so nobody can put their own text on the sign-in page with a link.
const REASONS: Record<string, string> = {
  'no-access': 'You don’t have access to VeQMS. Your access may have been removed, or your account isn’t set up yet. Ask a System Administrator if you think this is wrong.'
};

export async function GET(req: NextRequest) {
  const s = await getSession();
  await clearSession();
  const reason = REASONS[req.nextUrl.searchParams.get('reason') ?? ''];
  // Refused by VeQMS: end the VeQMS session and explain. The Microsoft session isn't the problem, so keep it.
  if (reason) return NextResponse.redirect(`${env.appBaseUrl}/login?err=${encodeURIComponent(reason)}`);
  return NextResponse.redirect(s?.devUser ? `${env.appBaseUrl}/login` : logoutUrl());
}
