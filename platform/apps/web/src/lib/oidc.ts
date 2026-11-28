import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from './env';
import type { Session } from './session';

// Microsoft Entra ID sign-in: authorisation code flow with PKCE, confidential client. Uses fetch only.
// Endpoints per the Microsoft identity platform v2.0 docs; verify against the current documentation.
const base = () => `https://login.microsoftonline.com/${env.tenantId}`;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keys() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${base()}/discovery/v2.0/keys`));
  return jwks;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function redirectUri(): string { return `${env.appBaseUrl}/auth/callback`; }
export function scopes(): string { return `openid profile offline_access ${env.apiScope}`; }

export interface PendingLogin { state: string; nonce: string; verifier: string; next: string }

export function newLogin(next: string): { url: string; pending: PendingLogin } {
  const pending: PendingLogin = { state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), next: safeNext(next) };
  const challenge = b64url(createHash('sha256').update(pending.verifier).digest());
  const q = new URLSearchParams({
    client_id: env.clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: scopes(),
    state: pending.state, nonce: pending.nonce, code_challenge: challenge, code_challenge_method: 'S256'
  });
  return { url: `${base()}/oauth2/v2.0/authorize?${q}`, pending };
}

interface TokenResponse { access_token: string; id_token?: string; refresh_token?: string; expires_in: number; error?: string; error_description?: string }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${base()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, ...params }),
    cache: 'no-store'
  });
  const body = (await res.json()) as TokenResponse;
  if (!res.ok || body.error) throw new Error(body.error_description || body.error || `Token request failed (${res.status})`);
  return body;
}

export async function completeLogin(code: string, pending: PendingLogin): Promise<Session> {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: pending.verifier, scope: scopes() });
  if (!t.id_token) throw new Error('Microsoft sign-in returned no ID token');
  const { payload } = await jwtVerify(t.id_token, keys(), { issuer: `${base()}/v2.0`, audience: env.clientId });
  if (payload.nonce !== pending.nonce) throw new Error('Sign-in check failed (nonce). Please try again.');
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + t.expires_in,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    email: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
    oid: typeof payload.oid === 'string' ? payload.oid : undefined
  };
}

export async function refresh(s: Session): Promise<Session> {
  if (!s.refreshToken) throw new Error('No refresh token');
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refreshToken, scope: scopes() });
  return { ...s, accessToken: t.access_token, refreshToken: t.refresh_token ?? s.refreshToken, expiresAt: Math.floor(Date.now() / 1000) + t.expires_in };
}

export function logoutUrl(): string {
  return `${base()}/oauth2/v2.0/logout?post_logout_redirect_uri=${encodeURIComponent(`${env.appBaseUrl}/login`)}`;
}

// Only allow redirects back into this app.
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/auth/')) return '/today';
  return next;
}
