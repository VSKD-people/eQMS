// SharePoint as the file store (docs/10-sharepoint.md): publishing Effective versions to the controlled library, the
// delta sync of both libraries, integrity alerts, and the nightly hash check. VeQMS is the master record: a version is
// Effective in VeQMS whether or not its published copy has reached SharePoint yet.
import { createHash } from 'node:crypto';
import { rows, one, maybe, withTenant, type Db, type Pool } from '@veqms/db';
import { DeltaExpired, type Library, type SharePoint, type SpChange } from '../integrations/sharepoint.ts';
import type { Storage } from '../integrations/storage.ts';
import { badRequest, conflict, notFound } from '../lib/http.ts';
import type { Person } from '../lib/people.ts';
import { audit, notify } from '../lib/work.ts';

export interface SpDeps { sharepoint: SharePoint; storage: Storage }
export const MAX_PUBLISH_ATTEMPTS = 5;
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function qualityManagers(db: Db): Promise<string[]> {
  return (await rows<{ id: string }>(db, `select u.id from app.users u join app.user_roles r on r.user_id = u.id and r.role = 'qm' where u.status = 'active'`)).map((r) => r.id);
}

type AlertKind = 'outside-change' | 'missing' | 'hash-mismatch' | 'publish-failed';
// Raise an integrity alert for QA, once: an open alert of the same kind for the same file or version isn't repeated.
export async function raiseAlert(db: Db, a: { kind: AlertKind; library?: Library; documentId?: string | null; versionId?: string | null; itemId?: string | null; number?: string; detail: string }): Promise<boolean> {
  const open = await maybe(db, `select 1 from app.integrity_alerts where resolved_at is null and kind = $1
    and coalesce(item_id, '') = coalesce($2, '') and coalesce(version_id::text, '') = coalesce($3::text, '') limit 1`, [a.kind, a.itemId ?? null, a.versionId ?? null]);
  if (open) return false;
  await db.query(`insert into app.integrity_alerts (tenant_id, kind, library, document_id, version_id, item_id, detail) values (app.current_tenant(), $1, $2, $3, $4, $5, $6)`,
    [a.kind, a.library ?? null, a.documentId ?? null, a.versionId ?? null, a.itemId ?? null, a.detail]);
  await audit(db, 'integrity.alert', a.number ? 'Document' : 'SharePoint', a.number ?? (a.itemId ?? 'library'), `Integrity alert (${a.kind}): ${a.detail}`);
  await notify(db, { to: await qualityManagers(db), kind: 'security', mandatory: true, title: `Integrity alert: ${a.number ?? 'SharePoint'}`, body: a.detail, href: '/admin?tab=sharepoint' });
  return true;
}

// ---------- Publishing ----------
// Upload the locked PDF of each version waiting to be published, set its columns, and mark the files of versions it
// superseded. Each version is tried on its own; a failure is retried next time, and after MAX_PUBLISH_ATTEMPTS it goes
// to dead_letters and QA is alerted. Graph is called inside the transaction, so the IDs it returns are kept with it.
export async function publishPending(db: Db, deps: SpDeps): Promise<{ published: number; failed: number; superseded: number }> {
  const sp = deps.sharepoint, col = sp.columns;
  const out = { published: 0, failed: 0, superseded: 0 };
  if (sp.mode === 'off') return out; // not connected: versions wait, and publish once SharePoint is connected
  const pending = await rows<{ id: string; version: string; content_sha256: string; pdf_blob: string | null; publish_attempts: number; published_item_id: string | null;
    document_id: string; number: string; effective_at: Date | null }>(db, `select v.id, v.version, v.content_sha256, v.pdf_blob, v.publish_attempts, v.published_item_id, d.id as document_id, d.number, d.effective_at
    from app.document_versions v join app.documents d on d.id = v.document_id where v.publish_status = 'pending' order by v.created_at`);
  for (const v of pending) {
    try {
      if (!v.pdf_blob) throw new Error('no locked PDF to publish');
      const bytes = new Uint8Array(await deps.storage.get(v.pdf_blob));
      if (sha256(bytes) !== v.content_sha256) throw new Error('the stored PDF no longer matches the version hash');
      let itemId = v.published_item_id;
      if (!itemId) {
        const item = await sp.upload('controlled', `${v.number} v${v.version}.pdf`, bytes, 'application/pdf');
        itemId = item.id;
        await db.query('update app.document_versions set published_item_id = $2, published_web_url = $3 where id = $1', [v.id, item.id, item.webUrl]);
      }
      await sp.setFields('controlled', itemId, { [col.number ?? 'DocumentNumber']: v.number, [col.version ?? 'DocumentVersion']: v.version, [col.status ?? 'DocumentStatus']: 'Effective',
        [col.effective ?? 'EffectiveDate']: (v.effective_at ?? new Date()).toISOString().slice(0, 10), [col.sha256 ?? 'SHA256']: v.content_sha256 });
      await db.query(`update app.document_versions set publish_status = 'published', published_at = now(), publish_error = null where id = $1`, [v.id]);
      await audit(db, 'publish', 'Document', v.number, `Published ${v.number} v${v.version} to the controlled SharePoint library`, null, { itemId, sha256: v.content_sha256 });
      out.published++;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 500);
      const attempts = v.publish_attempts + 1;
      if (attempts < MAX_PUBLISH_ATTEMPTS) {
        await db.query('update app.document_versions set publish_attempts = $2, publish_error = $3 where id = $1', [v.id, attempts, msg]);
      } else {
        await db.query(`update app.document_versions set publish_attempts = $2, publish_error = $3, publish_status = 'failed' where id = $1`, [v.id, attempts, msg]);
        await db.query(`insert into app.dead_letters (tenant_id, job, payload, attempts, last_error) values (app.current_tenant(), 'sharepoint-publish', $1, $2, $3)`,
          [JSON.stringify({ versionId: v.id, number: v.number, version: v.version }), attempts, msg]);
        await raiseAlert(db, { kind: 'publish-failed', library: 'controlled', documentId: v.document_id, versionId: v.id, number: v.number,
          detail: `${v.number} v${v.version} could not be published to the controlled library after ${attempts} attempts: ${msg}. It is Effective in VeQMS; publish it again from Administration once the cause is fixed.` });
      }
      out.failed++;
    }
  }
  // Files of versions no longer effective are marked, not removed: they stay in the library as history.
  const old = await rows<{ id: string; version: string; state: string; published_item_id: string; number: string }>(db, `select v.id, v.version, v.state, v.published_item_id, d.number
    from app.document_versions v join app.documents d on d.id = v.document_id where v.publish_status = 'published' and v.state in ('Superseded', 'Obsolete') and v.published_item_id is not null`);
  for (const v of old) {
    try {
      await sp.setFields('controlled', v.published_item_id, { [col.status ?? 'DocumentStatus']: v.state });
      await db.query(`update app.document_versions set publish_status = 'superseded' where id = $1`, [v.id]);
      await audit(db, 'publish', 'Document', v.number, `Marked the published file of ${v.number} v${v.version} ${v.state} in the controlled library`);
      out.superseded++;
    } catch { /* retried next run */ }
  }
  return out;
}

// Publish again after a failure (a Quality Manager, once the cause is fixed).
export async function republish(db: Db, versionId: string): Promise<void> {
  const r = await db.query(`update app.document_versions set publish_status = 'pending', publish_attempts = 0, publish_error = null where id = $1 and publish_status = 'failed'`, [versionId]);
  if (!r.rowCount) throw conflict('Only a version whose publishing failed can be published again.');
}

// ---------- Delta sync ----------
// Read the library's changes since the last good run. Controlled library: anything not written by the VeQMS app is an
// integrity alert (it never becomes a version). Drafts library: a draft's "last edited" moves on, and a PDF made from
// an older state of the Word file is cleared so the author makes it again.
export async function syncLibrary(db: Db, sp: SharePoint, lib: Library): Promise<{ outcome: 'ok' | 'failed'; changes: number; alerts: number; error?: string }> {
  const last = await maybe<{ delta_token: string }>(db, `select delta_token from app.sync_runs where library = $1 and outcome = 'ok' and delta_token is not null order by started_at desc limit 1`, [lib]);
  const run = await one<{ id: string }>(db, `insert into app.sync_runs (tenant_id, library) values (app.current_tenant(), $1) returning id`, [lib]);
  let alerts = 0, n = 0;
  try {
    const { changes, token } = await sp.delta(lib, last?.delta_token ?? null);
    for (const c of changes.filter((x) => !x.folder)) {
      n++;
      if (lib === 'controlled' ? await controlledChange(db, sp, c) : await draftChange(db, sp, c)) alerts++;
    }
    await db.query(`update app.sync_runs set finished_at = now(), outcome = 'ok', delta_token = $2, changes = $3, alerts = $4 where id = $1`, [run.id, token, n, alerts]);
    return { outcome: 'ok', changes: n, alerts };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    if (e instanceof DeltaExpired) {
      // Start again from now: changes made in the gap aren't known. The nightly hash check still covers every
      // published file, so QA is told and can run it early.
      const fresh = await sp.delta(lib, null).catch(() => null);
      if (fresh) {
        await db.query(`update app.sync_runs set finished_at = now(), outcome = 'ok', delta_token = $2, changes = $3, alerts = $4, error = $5 where id = $1`,
          [run.id, fresh.token, n, alerts, msg + '; restarted from now']);
        await audit(db, 'sharepoint.resync', 'SharePoint', lib, `The ${lib} library's change token expired; the sync restarted from now. Changes made in the gap were not seen`);
        await notify(db, { to: await qualityManagers(db), kind: 'warn', title: `SharePoint sync restarted (${lib} library)`,
          body: 'Its change token had expired, so changes made since the last sync were not seen. The nightly hash check still covers every published file.', href: '/admin?tab=sharepoint' });
        return { outcome: 'ok', changes: n, alerts, error: msg };
      }
    }
    await db.query(`update app.sync_runs set finished_at = now(), outcome = 'failed', changes = $2, alerts = $3, error = $4 where id = $1`, [run.id, n, alerts, msg]);
    return { outcome: 'failed', changes: n, alerts, error: msg };
  }
}

async function controlledChange(db: Db, sp: SharePoint, c: SpChange): Promise<boolean> {
  if (c.byApp === sp.appId && !c.deleted) return false; // VeQMS's own upload or column update
  const v = await maybe<{ id: string; version: string; document_id: string; number: string }>(db,
    `select v.id, v.version, d.id as document_id, d.number from app.document_versions v join app.documents d on d.id = v.document_id where v.published_item_id = $1`, [c.id]);
  const who = c.byName ?? 'someone';
  if (c.deleted) {
    if (!v) return false;
    return raiseAlert(db, { kind: 'missing', library: 'controlled', documentId: v.document_id, versionId: v.id, itemId: c.id, number: v.number,
      detail: `The published file of ${v.number} v${v.version} (${c.name}) was deleted from the controlled library. VeQMS still holds the locked PDF; publish it again.` });
  }
  return raiseAlert(db, { kind: 'outside-change', library: 'controlled', documentId: v?.document_id, versionId: v?.id, itemId: c.id, number: v?.number,
    detail: v
      ? `${c.name} (${v.number} v${v.version}) was changed in the controlled library outside VeQMS by ${who}${c.modifiedAt ? ' at ' + c.modifiedAt : ''}. Only VeQMS writes there: compare it with the locked PDF and restore it.`
      : `${c.name} was added or changed in the controlled library outside VeQMS by ${who}${c.modifiedAt ? ' at ' + c.modifiedAt : ''}. It is not a VeQMS version.` });
}

async function draftChange(db: Db, sp: SharePoint, c: SpChange): Promise<boolean> {
  const d = await maybe<{ id: string; number: string; state: string }>(db, 'select id, number, state from app.documents where draft_item_id = $1', [c.id]);
  if (!d) return false;
  if (c.deleted) {
    return raiseAlert(db, { kind: 'missing', library: 'drafts', documentId: d.id, itemId: c.id, number: d.number,
      detail: `The Word file of ${d.number} (${c.name}) was deleted from the Drafts library. Restore it from the SharePoint recycle bin.` });
  }
  await db.query('update app.documents set draft_edited_at = $2 where id = $1', [d.id, c.modifiedAt ?? new Date().toISOString()]);
  if (d.state !== 'Draft' || c.byApp === sp.appId) return false;
  const v = await maybe<{ id: string; version: string; pdf_source_tag: string | null }>(db,
    `select id, version, pdf_source_tag from app.document_versions where document_id = $1 order by created_at desc limit 1`, [d.id]);
  if (v?.pdf_source_tag && c.cTag && c.cTag !== v.pdf_source_tag) {
    await db.query('update app.document_versions set pdf_blob = null, verification = null, pdf_source_tag = null where id = $1', [v.id]);
    await audit(db, 'pdf.stale', 'Document', d.number, `The Word file of ${d.number} v${v.version} changed after its PDF was made (by ${c.byName ?? 'someone'}): the PDF has to be made again`);
  }
  return false;
}

// ---------- Nightly hash check ----------
// Download every published Effective file and compare its SHA-256 with the version's hash (the locked PDF's).
export async function hashCheck(db: Db, sp: SharePoint): Promise<{ checked: number; mismatches: number; missing: number; errors: number }> {
  const out = { checked: 0, mismatches: 0, missing: 0, errors: 0 };
  const vs = await rows<{ id: string; version: string; content_sha256: string; published_item_id: string; document_id: string; number: string }>(db,
    `select v.id, v.version, v.content_sha256, v.published_item_id, d.id as document_id, d.number from app.document_versions v join app.documents d on d.id = v.document_id
     where v.publish_status = 'published' and v.state = 'Effective' and v.published_item_id is not null order by d.number`);
  for (const v of vs) {
    let bytes: Uint8Array;
    try { bytes = await sp.download('controlled', v.published_item_id); } catch (e) {
      if (/404/.test(String((e as Error)?.message))) {
        out.missing++;
        await raiseAlert(db, { kind: 'missing', library: 'controlled', documentId: v.document_id, versionId: v.id, itemId: v.published_item_id, number: v.number,
          detail: `The published file of ${v.number} v${v.version} is missing from the controlled library (nightly check).` });
      } else out.errors++;
      continue;
    }
    out.checked++;
    const got = sha256(bytes);
    if (got !== v.content_sha256) {
      out.mismatches++;
      await raiseAlert(db, { kind: 'hash-mismatch', library: 'controlled', documentId: v.document_id, versionId: v.id, itemId: v.published_item_id, number: v.number,
        detail: `The published file of ${v.number} v${v.version} no longer matches its locked PDF (SHA-256 ${got.slice(0, 16)}…, expected ${v.content_sha256.slice(0, 16)}…).` });
    }
  }
  await audit(db, 'integrity.check', 'SharePoint', 'controlled library', `Nightly hash check: ${out.checked} published files checked, ${out.mismatches} mismatched, ${out.missing} missing, ${out.errors} not reachable`);
  return out;
}

// ---------- Administration ----------
export async function overview(db: Db, sp: SharePoint) {
  const runs = await rows<{ library: string; started_at: Date; finished_at: Date | null; outcome: string; changes: number; alerts: number; error: string | null }>(db,
    `select distinct on (library) library, started_at, finished_at, outcome, changes, alerts, error from app.sync_runs order by library, started_at desc`);
  const alerts = await rows<{ id: string; raised_at: Date; kind: string; library: string | null; detail: string; resolved_at: Date | null; resolution: string | null; resolved_by_name: string | null; number: string | null; version: string | null }>(db,
    `select a.id, a.raised_at, a.kind, a.library, a.detail, a.resolved_at, a.resolution, u.name as resolved_by_name, d.number, v.version
     from app.integrity_alerts a left join app.users u on u.id = a.resolved_by left join app.documents d on d.id = a.document_id left join app.document_versions v on v.id = a.version_id
     order by (a.resolved_at is null) desc, a.raised_at desc limit 200`);
  const publishing = await rows<{ id: string; number: string; version: string; publish_status: string; publish_attempts: number; publish_error: string | null; published_at: Date | null; published_web_url: string | null }>(db,
    `select v.id, d.number, v.version, v.publish_status, v.publish_attempts, v.publish_error, v.published_at, v.published_web_url
     from app.document_versions v join app.documents d on d.id = v.document_id where v.publish_status <> 'none' order by coalesce(v.published_at, v.created_at) desc limit 100`);
  return {
    mode: sp.mode,
    runs: runs.map((r) => ({ library: r.library, startedAt: r.started_at, finishedAt: r.finished_at, outcome: r.outcome, changes: r.changes, alerts: r.alerts, error: r.error })),
    alerts: alerts.map((a) => ({ id: a.id, raisedAt: a.raised_at, kind: a.kind, library: a.library, detail: a.detail, document: a.number, version: a.version,
      resolvedAt: a.resolved_at, resolution: a.resolution, resolvedBy: a.resolved_by_name })),
    publishing: publishing.map((p) => ({ versionId: p.id, number: p.number, version: p.version, status: p.publish_status, attempts: p.publish_attempts, error: p.publish_error, publishedAt: p.published_at, webUrl: p.published_web_url }))
  };
}

export async function resolveAlert(db: Db, me: Person, id: string, note: string): Promise<void> {
  const a = await maybe<{ kind: string; number: string | null }>(db, `select a.kind, d.number from app.integrity_alerts a left join app.documents d on d.id = a.document_id where a.id = $1`, [id]);
  if (!a) throw notFound('That alert doesn’t exist.');
  const r = await db.query(`update app.integrity_alerts set resolved_at = now(), resolved_by = $2, resolution = $3 where id = $1 and resolved_at is null`, [id, me.id, note]);
  if (!r.rowCount) throw conflict('This alert is already resolved.');
  await audit(db, 'integrity.resolve', a.number ? 'Document' : 'SharePoint', a.number ?? 'library', `Integrity alert (${a.kind}) resolved by ${me.name}: ${note}`);
}

// Mock mode only: someone edits the published file of a document's effective version outside VeQMS.
export async function simulateOutsideEdit(db: Db, sp: SharePoint, number: string, who: string): Promise<void> {
  if (sp.mode !== 'mock' || !sp.simulateOutsideEdit) throw badRequest('Only mock SharePoint can simulate an outside edit.');
  const v = await maybe<{ published_item_id: string }>(db, `select v.published_item_id from app.document_versions v join app.documents d on d.id = v.document_id
    where d.number = $1 and v.state = 'Effective' and v.published_item_id is not null`, [number]);
  if (!v) throw conflict(`${number} has no published file yet. Sync first, so Effective versions are published.`);
  await sp.simulateOutsideEdit('controlled', v.published_item_id, who);
  await audit(db, 'dev.simulate', 'Document', number, `Mock SharePoint: simulated an edit of the published file by ${who}, outside VeQMS`);
}

// The tenants SharePoint work runs for. One SharePoint site per deployment, like the Entra tenant.
export async function sharePointTenants(pool: Pool, entraTenantId: string): Promise<string[]> {
  const r = await pool.query<{ tenant_id: string }>(`select distinct tenant_id from app.tenant_directory where $1 = '' or entra_tenant_id = $1`, [entraTenantId]);
  return r.rows.map((x) => x.tenant_id);
}

// Publish, then sync both libraries, for one tenant (the 15-minute job and "Sync now").
export async function runSync(db: Db, deps: SpDeps) {
  if (deps.sharepoint.mode === 'off') throw conflict('SharePoint isn’t connected yet. Effective versions wait and are published once it is.');
  const publish = await publishPending(db, deps);
  const drafts = await syncLibrary(db, deps.sharepoint, 'drafts');
  const controlled = await syncLibrary(db, deps.sharepoint, 'controlled');
  return { publish, drafts, controlled };
}

// One publisher per API process: kick() after an agreement completes (a version may be waiting), and a timer.
export function createPublisher(pool: Pool, deps: SpDeps, entraTenantId: string, log: { error: (o: object, m: string) => void }) {
  let running = false, again = false, timer: NodeJS.Timeout | null = null;
  const kick = (): void => {
    if (running) { again = true; return; }
    running = true;
    (async () => {
      for (const t of await sharePointTenants(pool, entraTenantId)) await withTenant(pool, { tenantId: t, userId: null }, (db) => publishPending(db, deps));
    })()
      .catch((e) => log.error({ err: { message: String((e as Error)?.message ?? e) } }, 'SharePoint publishing failed'))
      .finally(() => { running = false; if (again) { again = false; kick(); } });
  };
  return {
    kick,
    start(everyMs = 60_000) { timer = setInterval(kick, everyMs); timer.unref(); },
    stop() { if (timer) clearInterval(timer); timer = null; }
  };
}
