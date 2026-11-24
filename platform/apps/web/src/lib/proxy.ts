import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { apiRaw, NotSignedIn } from './api';

// Stream a file from the API to the browser (reports, PDFs). The API checks permissions and logs exports.
const PASS = ['content-type', 'content-disposition', 'content-length', 'last-modified', 'etag'];

function toLogin(req: NextRequest): Response {
  const here = req.nextUrl.pathname + req.nextUrl.search;
  return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(here)}`, req.url));
}

export async function proxyFile(req: NextRequest, apiPath: string): Promise<Response> {
  let res: Response;
  try {
    res = await apiRaw(apiPath);
  } catch (e) {
    if (e instanceof NotSignedIn) return toLogin(req);
    throw e;
  }
  if (res.status === 401) return toLogin(req);
  if (!res.ok) {
    let message = `The service answered ${res.status}.`;
    try { message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message; } catch { /* not JSON */ }
    return new Response(message, { status: res.status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const headers = new Headers({ 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  for (const h of PASS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(res.body, { status: 200, headers });
}

export function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
