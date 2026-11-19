import 'server-only';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';
import { env } from './env';

// The session lives in an encrypted cookie (JWE, A256GCM). Entra tokens can be large, so the value is split
// across numbered cookies (veqms_session.0, .1 …) to stay under the 4 KB per-cookie limit.
export interface Session {
  devUser?: string;                 // development persona (X-Dev-User), only when DEV_AUTH=1
  accessToken?: string;             // Entra access token for the API
  refreshToken?: string;
  expiresAt?: number;               // access token expiry, epoch seconds
  name?: string;
  email?: string;
  oid?: string;
}

const NAME = 'veqms_session';
const MAX_AGE = 8 * 60 * 60;        // 8 hours, then sign in again
const CHUNK = 3800;

function key(): Uint8Array {
  const k = Buffer.from(env.sessionSecret, 'base64');
  if (k.length < 32) throw new Error('SESSION_SECRET must be at least 32 bytes, base64-encoded');
  return new Uint8Array(k.subarray(0, 32));
}

export async function sealSession(s: Session): Promise<string> {
  return new EncryptJWT({ ...s }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).encrypt(key());
}

export async function unsealSession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtDecrypt(token, key());
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

// Read the session in Server Components, Server Actions and Route Handlers.
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const parts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const c = jar.get(`${NAME}.${i}`);
    if (!c) break;
    parts.push(c.value);
  }
  if (!parts.length) return null;
  return unsealSession(parts.join(''));
}

// Write the session. Only allowed in Server Actions and Route Handlers.
export async function setSession(s: Session): Promise<void> {
  const jar = await cookies();
  const sealed = await sealSession(s);
  const chunks = sealed.match(new RegExp(`.{1,${CHUNK}}`, 'g')) ?? [];
  const opts = { httpOnly: true, secure: env.production, sameSite: 'lax' as const, path: '/', maxAge: MAX_AGE };
  chunks.forEach((c, i) => jar.set(`${NAME}.${i}`, c, opts));
  for (let i = chunks.length; i < 10; i++) if (jar.get(`${NAME}.${i}`)) jar.delete(`${NAME}.${i}`);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  for (let i = 0; i < 10; i++) if (jar.get(`${NAME}.${i}`)) jar.delete(`${NAME}.${i}`);
}

export function needsRefresh(s: Session): boolean {
  if (s.devUser) return false;
  return !s.accessToken || !s.expiresAt || s.expiresAt - 120 < Math.floor(Date.now() / 1000);
}
