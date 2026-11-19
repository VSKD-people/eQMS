'use server';
import { redirect } from 'next/navigation';
import { setSession } from '@/lib/session';
import { env } from '@/lib/env';
import { safeNext } from '@/lib/oidc';

const PERSONAS = ['dev-vic', 'dev-tom', 'dev-sam', 'dev-priya', 'dev-grace', 'dev-daniel', 'dev-hannah', 'dev-aud'];

// Development only: sign in as a seeded persona. The API also refuses X-Dev-User in production.
export async function devSignIn(fd: FormData) {
  if (!env.devAuth) redirect('/login?err=' + encodeURIComponent('Demo sign-in is switched off.'));
  const who = String(fd.get('persona') ?? '');
  if (!PERSONAS.includes(who)) redirect('/login?err=' + encodeURIComponent('Pick a persona.'));
  await setSession({ devUser: who });
  redirect(safeNext(String(fd.get('next') ?? '/today')));
}
