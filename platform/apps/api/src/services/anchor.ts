// Audit anchors: the head of the tenant's audit chain written to the immutable records container (see migration
// 007). anchor() writes a new one when the chain has grown; checkLatest() compares the latest anchor with the chain.
import { maybe, type Db } from '@veqms/db';
import type { Storage } from '../integrations/storage.ts';

export interface AnchorFile { tenant: string; seq: number; hash: string; at: string }

export async function anchor(db: Db, storage: Storage): Promise<AnchorFile | null> {
  const head = await maybe<{ tenant_id: string; seq: string; hash: string }>(db, 'select tenant_id, seq, hash from app.audit_log where tenant_id = app.current_tenant() order by seq desc limit 1');
  if (!head) return null;
  const last = await maybe<{ seq: string }>(db, 'select seq from app.audit_anchors order by seq desc limit 1');
  if (last && Number(last.seq) === Number(head.seq)) return null; // nothing new since the last anchor
  const file: AnchorFile = { tenant: head.tenant_id, seq: Number(head.seq), hash: head.hash, at: new Date().toISOString() };
  const key = `audit-anchors/${file.tenant}/${file.at.replace(/[:.]/g, '-')}-${file.seq}.json`;
  await storage.put(key, Buffer.from(JSON.stringify(file)), 'application/json'); // write-once: an existing key is refused
  await db.query('insert into app.audit_anchors (tenant_id, seq, hash, anchored_at, blob) values (app.current_tenant(), $1, $2, $3, $4)', [file.seq, file.hash, file.at, key]);
  return file;
}

export interface AnchorCheck { anchored: boolean; seq: number | null; at: string | null; matches: boolean | null; problem: string | null }

// The latest anchor's stored file, its database row and the chain entry it names must all agree.
export async function checkLatest(db: Db, storage: Storage): Promise<AnchorCheck> {
  const a = await maybe<{ seq: string; hash: string; anchored_at: Date; blob: string }>(db, 'select seq, hash, anchored_at, blob from app.audit_anchors order by seq desc limit 1');
  if (!a) return { anchored: false, seq: null, at: null, matches: null, problem: null };
  const base = { anchored: true, seq: Number(a.seq), at: new Date(a.anchored_at).toISOString() };
  let file: AnchorFile;
  try { file = JSON.parse((await storage.get(a.blob)).toString('utf8')) as AnchorFile; } catch { return { ...base, matches: false, problem: 'The anchor file could not be read from storage.' }; }
  const entry = await maybe<{ hash: string }>(db, 'select hash from app.audit_log where tenant_id = app.current_tenant() and seq = $1', [a.seq]);
  if (!entry) return { ...base, matches: false, problem: `Audit entry ${a.seq} named by the anchor is missing.` };
  if (file.seq !== Number(a.seq) || file.hash !== a.hash) return { ...base, matches: false, problem: 'The anchor list in the database differs from the anchor file.' };
  if (entry.hash !== file.hash) return { ...base, matches: false, problem: `Audit entry ${a.seq} no longer has the hash anchored on ${base.at}: the chain was rewritten.` };
  return { ...base, matches: true, problem: null };
}
