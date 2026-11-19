import { NextResponse, type NextRequest } from 'next/server';
import { getSession, setSession } from '@/lib/session';
import { refresh, safeNext } from '@/lib/oidc';
import { env } from '@/lib/env';

// Pages can't write cookies, so an expired access token comes here to be refreshed, then goes back.
export async function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  const s = await getSession();
  if (!s) return NextResponse.redirect(`${env.appBaseUrl}/login?next=${encodeURIComponent(next)}`);
  try {
    await setSession(await refresh(s));
    return NextResponse.redirect(`${env.appBaseUrl}${next}`);
  } catch {
    return NextResponse.redirect(`${env.appBaseUrl}/auth/start?next=${encodeURIComponent(next)}`);
  }
}
