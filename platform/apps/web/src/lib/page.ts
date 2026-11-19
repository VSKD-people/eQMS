import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { api, ApiError, NotSignedIn } from './api';
import type { Me } from './types';

export async function currentPath(): Promise<string> {
  return (await headers()).get('x-veqms-path') ?? '/today';
}

// Load data for a page. Not signed in → sign-in page; anything else bubbles to the error boundary.
export async function load<T>(path: string): Promise<T> {
  const here = await currentPath();
  try {
    return await api<T>(path, { next: here });
  } catch (e) {
    if (e instanceof NotSignedIn) redirect(`/login?next=${encodeURIComponent(here)}`);
    throw e;
  }
}

// Like load, but returns null on 403/404 so a page can show "not available" instead of failing.
export async function loadOrNull<T>(path: string): Promise<T | null> {
  try { return await load<T>(path); } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

export const getMe = cache(async () => load<Me>('/me'));

export function has(me: Me, perm: string): boolean { return me.permissions.includes(perm); }
