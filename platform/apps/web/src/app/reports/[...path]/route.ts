import type { NextRequest } from 'next/server';
import { notFound, proxyFile } from '@/lib/proxy';

// /reports/<name>.<format>?filters → GET /api/v1/reports/<name>.<format>?filters (see docs/03-api.md).
const NAMES = new Set(['training-matrix', 'training-records', 'document-status', 'approvals-register', 'signing-transactions']);
const FORMATS = new Set(['pdf', 'xlsx']);

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.length !== 1) return notFound();
  const m = /^([a-z-]+)\.([a-z]+)$/.exec(path[0] ?? '');
  if (!m || !NAMES.has(m[1] ?? '') || !FORMATS.has(m[2] ?? '')) return notFound();
  return proxyFile(req, `/reports/${m[1]}.${m[2]}${req.nextUrl.search}`);
}
