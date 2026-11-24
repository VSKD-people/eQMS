import type { NextRequest } from 'next/server';
import { notFound, proxyFile } from '@/lib/proxy';

// Only these file paths are passed to the API:
//   /files/agreements/<id>/<original|signed|audit-report>        → /agreements/<id>/files/<kind>
//   /files/documents/<number>/pdf[?version=]                     → /documents/<number>/pdf[?version=]
//   /files/capas/<number>/pdf, /files/quality-events/<number>/pdf → same path on the API
const ID = /^[A-Za-z0-9._-]{1,80}$/;
const KINDS = new Set(['original', 'signed', 'audit-report']);

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [area, id, kind] = path;
  if (path.length !== 3 || !area || !id || !kind || !ID.test(id)) return notFound();
  const n = encodeURIComponent(id);
  if (area === 'agreements' && KINDS.has(kind)) return proxyFile(req, `/agreements/${n}/files/${kind}`);
  if (area === 'documents' && kind === 'pdf') {
    const v = req.nextUrl.searchParams.get('version');
    const q = v && /^\d{1,4}(\.\d{1,4})?$/.test(v) ? `?version=${encodeURIComponent(v)}` : '';
    return proxyFile(req, `/documents/${n}/pdf${q}`);
  }
  if ((area === 'capas' || area === 'quality-events') && kind === 'pdf') return proxyFile(req, `/${area}/${n}/pdf`);
  return notFound();
}
