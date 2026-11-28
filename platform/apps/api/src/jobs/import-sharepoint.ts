// One-off import of today's controlled SharePoint library (docs/08-migration.md). Reads every PDF in the library and
// its columns through Microsoft Graph, maps them with SHAREPOINT_IMPORT_MAP, and brings each document in as one
// Effective version (migrated_from 'SharePoint'), pointing at the file already in the library.
//
//   node apps/api/dist/jobs/import-sharepoint.js --tenant <tenant id>            dry run: report only, nothing written
//   node apps/api/dist/jobs/import-sharepoint.js --tenant <tenant id> --apply    import what maps cleanly
//
// Runs as veqms_owner with import mode on (historical dates), like the demo seed: use the migration identity's
// connection, never the API's. Anything that can't be mapped is listed and left out. The report is printed as JSON:
// keep it, with the hash of the listing, as migration evidence.
import { createHash } from 'node:crypto';
import { DOC_TYPES } from '@veqms/domain';
import { loadConfig } from '../config.ts';
import { createSharePoint } from '../integrations/sharepoint.ts';
import { createStorage } from '../integrations/storage.ts';
import { poolFor } from '../server.ts';

type Row = { itemId: string; file: string; webUrl?: string; number: string; title: string; type: string; prefix: string; version: string; ownerEmail: string;
  classification: string; process: string; effective: string };

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

async function main(): Promise<void> {
  const cfg = loadConfig();
  const tenant = arg('--tenant');
  const apply = process.argv.includes('--apply');
  if (!tenant || !/^[0-9a-f-]{36}$/i.test(tenant)) throw new Error('Give the VeQMS tenant ID: --tenant <uuid>');
  const map = JSON.parse(cfg.SHAREPOINT_IMPORT_MAP) as Record<string, string>;
  const pool = await poolFor(cfg);
  const sp = createSharePoint(cfg), storage = createStorage(cfg, pool);
  const report: { file: string; number?: string; problems: string[] }[] = [];
  const rows: Row[] = [];
  try {
    const listing = (await sp.delta('controlled', null, true)).changes.filter((c) => !c.folder && !c.deleted);
    const listingSha = createHash('sha256').update(JSON.stringify(listing.map((c) => [c.id, c.name, c.cTag]))).digest('hex');
    const users = (await pool.query<{ email: string; id: string }>(`select lower(email) as email, id from app.users where tenant_id = $1 and status = 'active'`, [tenant])).rows;
    const existing = new Set((await pool.query<{ number: string }>('select number from app.documents where tenant_id = $1', [tenant])).rows.map((r) => r.number));
    const seen = new Map<string, string>();
    for (const c of listing) {
      const problems: string[] = [];
      if (!/\.pdf$/i.test(c.name)) { report.push({ file: c.name, problems: ['not a PDF: left out'] }); continue; }
      const f = await sp.fields('controlled', c.id);
      const get = (k: string) => { const col = map[k]; const v = col ? f[col] : undefined; return v === undefined || v === null ? '' : String(v).trim(); };
      const number = get('number').toUpperCase(), version = get('version'), typeName = get('type');
      const t = DOC_TYPES.find((x) => x.type.toLowerCase() === typeName.toLowerCase() || x.prefix === typeName.toUpperCase() || x.prefix === number.split('-')[0]);
      const classification = get('classification') || 'Internal';
      const effective = get('effective');
      if (!/^[A-Z]+-\d+$/.test(number)) problems.push(`document number "${number}" is not like SOP-012`);
      if (!/^\d+\.\d+$/.test(version)) problems.push(`version "${version}" is not like 3.0`);
      if (!t) problems.push(`document type "${typeName}" is not a VeQMS type`);
      if (!get('title')) problems.push('no title');
      if (!users.some((u) => u.email === get('owner').toLowerCase())) problems.push(`owner "${get('owner')}" is not an active VeQMS user (provision people through Entra first)`);
      if (!['Public', 'Internal', 'Confidential', 'Restricted'].includes(classification)) problems.push(`classification "${classification}" is not Public, Internal, Confidential or Restricted`);
      if (!effective || Number.isNaN(Date.parse(effective))) problems.push(`effective date "${effective}" is not a date`);
      if (existing.has(number)) problems.push(`${number} is already in VeQMS`);
      if (seen.has(number)) problems.push(`${number} appears twice (also ${seen.get(number)}): keep one effective file per document`);
      seen.set(number, c.name);
      report.push({ file: c.name, number, problems });
      if (!problems.length) rows.push({ itemId: c.id, file: c.name, webUrl: (await sp.getItem('controlled', c.id))?.webUrl, number, title: get('title'), type: t!.type, prefix: t!.prefix, version, ownerEmail: get('owner').toLowerCase(),
        classification, process: get('process') || 'Imported from SharePoint', effective });
    }
    console.log(JSON.stringify({ job: 'import-sharepoint', mode: apply ? 'apply' : 'dry-run', files: listing.length, listingSha256: listingSha, importable: rows.length,
      problems: report.filter((r) => r.problems.length) }, null, 2));
    if (!apply) return;

    let imported = 0;
    for (const r of rows) {
      const bytes = await sp.download('controlled', r.itemId);
      const sha = createHash('sha256').update(bytes).digest('hex');
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('set local role veqms_owner');
        await client.query("select set_config('app.import_mode', 'on', true), set_config('app.tenant_id', $1, true)", [tenant]);
        const owner = users.find((u) => u.email === r.ownerEmail)!.id;
        const d = await client.query<{ id: string }>(`insert into app.documents (tenant_id, number, doc_type, title, state, classification, owner_id, author_id, process, effective_at)
          values ($1, $2, $3, $4, 'Effective', $5, $6, $6, $7, $8) returning id`, [tenant, r.number, r.type, r.title, r.classification, owner, r.process, r.effective]);
        const docId = d.rows[0]!.id;
        const key = `documents/${docId}/v${r.version}-${sha.slice(0, 16)}-imported.pdf`;
        await storage.put(key, bytes, 'application/pdf');
        await client.query(`insert into app.document_versions (tenant_id, document_id, version, kind, state, summary, content, content_sha256, pdf_blob, created_by, created_at, approved_at,
            migrated_from, published_item_id, published_web_url, published_at, publish_status)
          values ($1, $2, $3, 'major', 'Effective', 'Imported from SharePoint', '[]', $4, $5, $6, $7, $7, 'SharePoint', $8, $9, $7, 'published')`,
          [tenant, docId, r.version, sha, key, owner, r.effective, r.itemId, r.webUrl ?? null]);
        await client.query(`update app.counters set value = greatest(value, $2) where tenant_id = $1 and prefix = $3`, [tenant, Number(r.number.split('-')[1]), r.prefix]);
        await client.query(`select app.audit('import', 'Document', $1, $2, null, $3::jsonb)`, [r.number, `Imported ${r.number} v${r.version} from the controlled SharePoint library (${r.file})`,
          JSON.stringify({ itemId: r.itemId, sha256: sha, listingSha256: listingSha })]);
        await client.query('commit');
        imported++;
      } catch (e) {
        await client.query('rollback');
        console.error(JSON.stringify({ job: 'import-sharepoint', file: r.file, error: String(e) }));
      } finally {
        client.release();
      }
    }
    console.log(JSON.stringify({ job: 'import-sharepoint', imported, of: rows.length }));
    console.log('Next: set each document\'s audience and periodic review in VeQMS, and reconcile the counts with the Quality Manager.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
