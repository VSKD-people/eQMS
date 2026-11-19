import { NextResponse } from 'next/server';
import { clearSession, getSession } from '@/lib/session';
import { logoutUrl } from '@/lib/oidc';
import { env } from '@/lib/env';

export async function GET() {
  const s = await getSession();
  await clearSession();
  return NextResponse.redirect(s?.devUser ? `${env.appBaseUrl}/login` : logoutUrl());
}
