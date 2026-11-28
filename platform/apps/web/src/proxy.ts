import { NextResponse, type NextRequest } from 'next/server';

// No access control here: pages are protected in the (app) layout and by the API. This only passes the
// requested path on to Server Components, so sign-in and token refresh can return people where they were.
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-veqms-path', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!_next/|img/|favicon).*)'] };
