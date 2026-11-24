import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from './env';
import { getSession, needsRefresh, setSession, type Session } from './session';
import { refresh } from './oidc';

// Server-side client for the VeQMS API. The browser never calls the API: pages and Server Actions call it here,
// with the signed-in user's Entra access token (or X-Dev-User in development).

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); this.name = 'ApiError'; }
}

export class NotSignedIn extends Error {
  constructor() { super('Not signed in'); this.name = 'NotSignedIn'; }
}

function authHeaders(s: Session): Record<string, string> {
  if (s.devUser) {
    if (!env.devAuth) throw new NotSignedIn();
    return { 'x-dev-user': s.devUser };
  }
  if (!s.accessToken) throw new NotSignedIn();
  return { authorization: `Bearer ${s.accessToken}` };
}

// In Server Components cookies are read-only, so an expired token sends the user through /auth/refresh.
// In Server Actions and Route Handlers (canWrite) the token is refreshed in place.
async function currentSession(canWrite: boolean, next?: string): Promise<Session> {
  const s = await getSession();
  if (!s) throw new NotSignedIn();
  if (!needsRefresh(s)) return s;
  if (!canWrite) redirect(`/auth/refresh?next=${encodeURIComponent(next ?? '/today')}`);
  try {
    const fresh = await refresh(s);
    await setSession(fresh);
    return fresh;
  } catch {
    throw new NotSignedIn();
  }
}

// The person's IP address and device, passed on to the API for the audit trail. The first X-Forwarded-For address is
// the one Azure's ingress saw; the user agent is the browser's.
async function clientHeaders(): Promise<Record<string, string>> {
  try {
    const h = await headers();
    const ip = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || h.get('x-real-ip') || '';
    const ua = h.get('user-agent') ?? '';
    return { ...(ip ? { 'x-veqms-client-ip': ip } : {}), ...(ua ? { 'x-veqms-user-agent': ua.slice(0, 500) } : {}) };
  } catch {
    return {}; // outside a request (should not happen for API calls)
  }
}

export interface CallOptions { method?: string; body?: unknown; canWrite?: boolean; next?: string }

export async function api<T>(path: string, o: CallOptions = {}): Promise<T> {
  const s = await currentSession(!!o.canWrite || (o.method ?? 'GET') !== 'GET', o.next);
  const res = await fetch(`${env.apiBaseUrl}/api/v1${path}`, {
    method: o.method ?? 'GET',
    headers: { accept: 'application/json', ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}), ...authHeaders(s), ...(await clientHeaders()) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    cache: 'no-store'
  });
  if (res.status === 401) throw new NotSignedIn();
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.message ?? `The service answered ${res.status}`, err?.code);
  }
  return data as T;
}

// Raw response for file downloads (reports, PDFs). Used by Route Handlers, which can refresh tokens.
export async function apiRaw(path: string): Promise<Response> {
  const s = await currentSession(true);
  return fetch(`${env.apiBaseUrl}/api/v1${path}`, { headers: { ...authHeaders(s), ...(await clientHeaders()) }, cache: 'no-store' });
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof NotSignedIn) return 'Your session has ended. Sign in again.';
  return 'Something went wrong. Try again, and tell the Quality Manager if it keeps happening.';
}

// Helpers for Server Actions: read form fields.
export function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === 'string' ? v.trim() : '';
}
export function list(fd: FormData, name: string): string[] {
  return fd.getAll(name).filter((v): v is string => typeof v === 'string' && v !== '');
}
export function bool(fd: FormData, name: string): boolean {
  return fd.get(name) === 'on' || fd.get(name) === 'true';
}
