// SharePoint document libraries through Microsoft Graph (docs/10-sharepoint.md). Two libraries on one site:
//   drafts      the authors' Word files, one per document, edited version after version
//   controlled  the locked PDF of every Effective version, written only by VeQMS (Sites.Selected, write)
// Live mode calls Graph v1.0 app-only with the API's managed identity. Mock mode keeps both libraries in a folder
// under LOCAL_STORAGE_DIR, records who changed what, and can simulate an edit made outside VeQMS.
//
// None of the live calls has run against SharePoint yet. Each one marked "verify" must be checked against Microsoft's
// documentation and a test site before go-live (the list is in docs/10-sharepoint.md). In particular: whether the PDF
// conversion has a file-size limit, that lastModifiedBy.application.id carries the managed identity's app ID, and that
// delta reports column (metadata) changes as well as content changes.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from '../config.ts';

export type Library = 'drafts' | 'controlled';
export interface SpItem { id: string; name: string; webUrl: string; cTag: string | null }
export interface SpChange {
  id: string; name: string; deleted: boolean; folder: boolean; modifiedAt: string | null; cTag: string | null;
  byApp: string | null; byUser: string | null; byName: string | null;
}
export interface SharePoint {
  mode: 'live' | 'mock';
  appId: string;                                       // changes by this app ID are VeQMS's own
  columns: Record<string, string>;                     // controlled library columns: number, version, status, effective, sha256
  createDraft(fileName: string, docx: Uint8Array): Promise<SpItem>;
  getItem(lib: Library, itemId: string): Promise<SpItem | null>;
  pdfOf(itemId: string): Promise<Uint8Array>;          // a Drafts Word file converted to PDF
  upload(lib: Library, fileName: string, bytes: Uint8Array, contentType: string): Promise<SpItem>;
  setFields(lib: Library, itemId: string, fields: Record<string, unknown>): Promise<void>;
  fields(lib: Library, itemId: string): Promise<Record<string, unknown>>;
  download(lib: Library, itemId: string): Promise<Uint8Array>;
  // Changes since the token. No token: start from now (live: token=latest), or with fromStart every file in the library.
  delta(lib: Library, token: string | null, fromStart?: boolean): Promise<{ changes: SpChange[]; token: string }>;
  // Mock only: someone edits a file outside VeQMS (for demonstrations and tests of the integrity alert).
  simulateOutsideEdit?(lib: Library, itemId: string, who: string): Promise<void>;
}

// The change token can no longer be used (verify: Graph answers 410 Gone when a delta token has expired). The sync
// starts again from now, and says so.
export class DeltaExpired extends Error { constructor(lib: Library) { super(`The change token for the ${lib} library has expired`); this.name = 'DeltaExpired'; } }

export function createSharePoint(cfg: Config): SharePoint {
  const columns = JSON.parse(cfg.SHAREPOINT_COLUMNS) as Record<string, string>;
  return cfg.SHAREPOINT_MODE === 'live' ? live(cfg, columns) : mock(join(cfg.LOCAL_STORAGE_DIR, '.sharepoint-mock'), columns);
}

// ---------- Live: Microsoft Graph v1.0 ----------
const G = 'https://graph.microsoft.com/v1.0';
const MAX_SIMPLE_UPLOAD = 250 * 1024 * 1024; // verify: simple upload limit (Graph docs say 250 MB; older answers say 4 MB)

function live(cfg: Config, columns: Record<string, string>): SharePoint {
  let cached: { token: string; until: number } | null = null;
  const listIds = new Map<Library, string>();
  const drive = (lib: Library) => (lib === 'drafts' ? cfg.SHAREPOINT_DRAFTS_DRIVE_ID : cfg.SHAREPOINT_CONTROLLED_DRIVE_ID);
  const path = (name: string) => name.split('/').map(encodeURIComponent).join('/');

  async function token(): Promise<string> {
    if (cached && cached.until > Date.now()) return cached.token;
    const { DefaultAzureCredential } = await import('@azure/identity');
    const t = await new DefaultAzureCredential().getToken('https://graph.microsoft.com/.default');
    if (!t) throw new Error('No Entra ID token for Microsoft Graph. Check the managed identity.');
    cached = { token: t.token, until: t.expiresOnTimestamp - 5 * 60_000 };
    return t.token;
  }

  // Throttled (429) or briefly unavailable (503, 504): wait as Retry-After says (verify: seconds), up to 4 tries.
  async function call(method: string, url: string, init: { body?: Buffer | string; type?: string } = {}): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, { method, body: init.body, headers: { authorization: `Bearer ${await token()}`, ...(init.type ? { 'content-type': init.type } : {}) } });
      if (![429, 503, 504].includes(res.status) || attempt >= 4) return res;
      const wait = Math.min(30, Number(res.headers.get('retry-after')) || 2 ** attempt);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
  async function ok(res: Response, what: string): Promise<Response> {
    if (res.ok) return res;
    throw new Error(`SharePoint ${what} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const json = async <T>(res: Response, what: string) => (await (await ok(res, what)).json()) as T;
  type GraphItem = { id: string; name: string; webUrl: string; cTag?: string; deleted?: object; folder?: object; lastModifiedDateTime?: string;
    lastModifiedBy?: { application?: { id?: string; displayName?: string }; user?: { id?: string; displayName?: string } } };
  const toItem = (i: GraphItem): SpItem => ({ id: i.id, name: i.name, webUrl: i.webUrl, cTag: i.cTag ?? null });

  async function putNew(lib: Library, fileName: string, bytes: Uint8Array, type: string): Promise<SpItem> {
    if (bytes.length > MAX_SIMPLE_UPLOAD) throw new Error('File too large for a simple upload; upload sessions are not built yet.');
    // verify: PUT /drives/{drive-id}/root:/{path}:/content, with conflictBehavior=fail so nothing is overwritten.
    const res = await call('PUT', `${G}/drives/${drive(lib)}/root:/${path(fileName)}:/content?@microsoft.graph.conflictBehavior=fail`, { body: Buffer.from(bytes), type });
    return toItem(await json<GraphItem>(res, `upload of ${fileName}`));
  }
  async function listId(lib: Library): Promise<string> {
    // verify: GET /drives/{drive-id}/list returns the document library's list (its id is needed for the fields call).
    if (!listIds.has(lib)) listIds.set(lib, (await json<{ id: string }>(await call('GET', `${G}/drives/${drive(lib)}/list?$select=id`), 'list lookup')).id);
    return listIds.get(lib)!;
  }
  async function listItemId(lib: Library, itemId: string): Promise<string> {
    // verify: GET /drives/{drive-id}/items/{item-id}/listItem gives the list item behind a file.
    return (await json<{ id: string }>(await call('GET', `${G}/drives/${drive(lib)}/items/${itemId}/listItem?$select=id`), 'list item lookup')).id;
  }

  return {
    mode: 'live', appId: cfg.SHAREPOINT_APP_ID, columns,
    createDraft: (fileName, docx) => putNew('drafts', fileName, docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    async getItem(lib, itemId) {
      const res = await call('GET', `${G}/drives/${drive(lib)}/items/${itemId}?$select=id,name,webUrl,cTag`);
      if (res.status === 404) return null;
      return toItem(await json<GraphItem>(res, 'item lookup'));
    },
    async pdfOf(itemId) {
      // verify: GET …/content?format=pdf answers 302 to a pre-authenticated URL (fetch follows it and drops the
      // Authorization header on the cross-origin redirect); Word formats convert; a size limit may apply.
      const res = await call('GET', `${G}/drives/${drive('drafts')}/items/${itemId}/content?format=pdf`);
      return new Uint8Array(await (await ok(res, 'conversion to PDF')).arrayBuffer());
    },
    upload: putNew,
    async setFields(lib, itemId, fields) {
      // verify: PATCH /sites/{site-id}/lists/{list-id}/items/{item-id}/fields with column internal names.
      const res = await call('PATCH', `${G}/sites/${cfg.SHAREPOINT_SITE_ID}/lists/${await listId(lib)}/items/${await listItemId(lib, itemId)}/fields`,
        { body: JSON.stringify(fields), type: 'application/json' });
      await ok(res, 'column update');
    },
    async fields(lib, itemId) {
      // verify: GET /drives/{drive-id}/items/{item-id}/listItem?$expand=fields returns the column values.
      return (await json<{ fields?: Record<string, unknown> }>(await call('GET', `${G}/drives/${drive(lib)}/items/${itemId}/listItem?$expand=fields`), 'column read')).fields ?? {};
    },
    async download(lib, itemId) {
      // verify: GET /drives/{drive-id}/items/{item-id}/content answers 302 to the file.
      const res = await call('GET', `${G}/drives/${drive(lib)}/items/${itemId}/content`);
      return new Uint8Array(await (await ok(res, 'download')).arrayBuffer());
    },
    async delta(lib, startToken, fromStart = false) {
      // verify: GET /drives/{drive-id}/root/delta pages with @odata.nextLink and ends with @odata.deltaLink, the token
      // for next time; token=latest starts from now; deleted items carry `deleted`; lastModifiedBy is included.
      let url = startToken ?? `${G}/drives/${drive(lib)}/root/delta${fromStart ? '' : '?token=latest'}`;
      const changes: SpChange[] = [];
      for (let page = 0; page < 10_000; page++) {
        const res = await call('GET', url);
        if (res.status === 410 && startToken) throw new DeltaExpired(lib);
        const r = await json<{ value: GraphItem[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }>(res, 'delta');
        for (const i of r.value) {
          changes.push({ id: i.id, name: i.name, deleted: !!i.deleted, folder: !!i.folder, modifiedAt: i.lastModifiedDateTime ?? null, cTag: i.cTag ?? null,
            byApp: i.lastModifiedBy?.application?.id ?? null, byUser: i.lastModifiedBy?.user?.id ?? null,
            byName: i.lastModifiedBy?.user?.displayName ?? i.lastModifiedBy?.application?.displayName ?? null });
        }
        if (r['@odata.nextLink']) { url = r['@odata.nextLink']; continue; }
        if (r['@odata.deltaLink']) return { changes, token: r['@odata.deltaLink'] };
        throw new Error('SharePoint delta answered without a next or delta link');
      }
      throw new Error('SharePoint delta did not finish');
    }
  };
}

// ---------- Mock: a folder ----------
interface MockItem { id: string; lib: Library; name: string; cTag: string; fields: Record<string, unknown> }
interface MockChange { seq: number; lib: Library; id: string; name: string; at: string; byApp: string | null; byUser: string | null; byName: string | null; cTag: string; deleted: boolean }
interface MockState { seq: number; items: Record<string, MockItem>; changes: MockChange[] }
export const MOCK_APP_ID = 'veqms-mock-app';

function mock(dir: string, columns: Record<string, string>): SharePoint {
  const statePath = join(dir, 'state.json');
  let chain: Promise<unknown> = Promise.resolve();
  // One change at a time within the process; the state file is read and written whole.
  function locked<T>(fn: (s: MockState) => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      await mkdir(join(dir, 'files'), { recursive: true });
      const s: MockState = await readFile(statePath, 'utf8').then((t) => JSON.parse(t) as MockState).catch(() => ({ seq: 0, items: {}, changes: [] }));
      const out = await fn(s);
      await writeFile(statePath, JSON.stringify(s));
      return out;
    });
    chain = run.catch(() => undefined);
    return run;
  }
  const tag = (b: Uint8Array) => '"c:' + createHash('sha256').update(b).digest('hex').slice(0, 16) + '"';
  const toItem = (i: MockItem): SpItem => ({ id: i.id, name: i.name, webUrl: `mock-sharepoint://${i.lib}/${encodeURIComponent(i.name)}`, cTag: i.cTag });
  const record = (s: MockState, i: MockItem, by: { app?: string; user?: string; name: string }, deleted = false) => {
    s.seq++;
    s.changes.push({ seq: s.seq, lib: i.lib, id: i.id, name: i.name, at: new Date().toISOString(), byApp: by.app ?? null, byUser: by.user ?? null, byName: by.name, cTag: i.cTag, deleted });
  };
  const self = { app: MOCK_APP_ID, name: 'VeQMS' };
  async function add(lib: Library, name: string, bytes: Uint8Array): Promise<SpItem> {
    return locked(async (s) => {
      if (Object.values(s.items).some((i) => i.lib === lib && i.name === name)) throw new Error(`SharePoint upload of ${name} failed: 409 a file with that name already exists`);
      const i: MockItem = { id: `mock-${lib}-${randomUUID()}`, lib, name, cTag: tag(bytes), fields: {} };
      await writeFile(join(dir, 'files', i.id), bytes);
      s.items[i.id] = i;
      record(s, i, self);
      return toItem(i);
    });
  }
  const get = (s: MockState, lib: Library, id: string) => { const i = s.items[id]; if (!i || i.lib !== lib) throw new Error(`SharePoint item ${id} not found: 404`); return i; };
  return {
    mode: 'mock', appId: MOCK_APP_ID, columns,
    createDraft: (fileName, docx) => add('drafts', fileName, docx),
    getItem: (lib, id) => locked(async (s) => { const i = s.items[id]; return i && i.lib === lib ? toItem(i) : null; }),
    async pdfOf() { throw new Error('Mock SharePoint has no Word conversion: in mock mode the draft is written in VeQMS and VeQMS makes the PDF.'); },
    upload: (lib, fileName, bytes) => add(lib, fileName, bytes),
    setFields: (lib, id, fields) => locked(async (s) => { const i = get(s, lib, id); i.fields = { ...i.fields, ...fields }; record(s, i, self); }),
    fields: (lib, id) => locked(async (s) => ({ ...get(s, lib, id).fields })),
    download: (lib, id) => locked(async (s) => { get(s, lib, id); return new Uint8Array(await readFile(join(dir, 'files', id))); }),
    delta: (lib, startToken, fromStart = false) => locked(async (s) => {
      if (startToken === null && !fromStart) return { changes: [], token: String(s.seq) };
      const from = startToken === null ? 0 : Number(startToken);
      const latest = new Map<string, MockChange>();
      for (const c of s.changes) if (c.lib === lib && c.seq > from) latest.set(c.id, c);
      return { changes: [...latest.values()].map((c) => ({ id: c.id, name: c.name, deleted: c.deleted, folder: false, modifiedAt: c.at, cTag: c.cTag, byApp: c.byApp, byUser: c.byUser, byName: c.byName })), token: String(s.seq) };
    }),
    simulateOutsideEdit: (lib, id, who) => locked(async (s) => {
      const i = get(s, lib, id);
      const bytes = Buffer.concat([await readFile(join(dir, 'files', id)), Buffer.from(`\n% edited outside VeQMS by ${who}\n`)]);
      await writeFile(join(dir, 'files', id), bytes);
      i.cTag = tag(bytes);
      record(s, i, { user: 'outside-user', name: who });
    })
  };
}
