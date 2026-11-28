// File storage for locked PDFs, signed PDFs, audit reports and audit anchors. Every key is written once.
// azure: a Blob container with versioning and a time-based immutability policy (see infra). local: a folder (docker
// compose). database: the write-once app.file_store table, so a container host needs no disk (pilot); files are then
// backed up with the database. In that mode the audit anchors are stored in the same database they protect, so they
// stop showing a rewrite by a database administrator: use Azure storage for production.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { Pool } from '@veqms/db';
import type { Config } from '../config.ts';

export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

function safeKey(key: string): string {
  const k = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  if (k.startsWith('/') || k.includes('..')) throw new Error('Invalid storage key');
  return k;
}

export function createStorage(cfg: Config, pool?: Pool): Storage {
  if (cfg.STORAGE_MODE === 'database') {
    if (!pool) throw new Error('STORAGE_MODE=database needs the database pool');
    return {
      async put(key, bytes, contentType) {
        const k = safeKey(key);
        const sha = createHash('sha256').update(bytes).digest('hex');
        try {
          await pool.query('insert into app.file_store (key, content_type, bytes, sha256, size) values ($1, $2, $3, $4, $5)', [k, contentType, Buffer.from(bytes), sha, bytes.length]);
        } catch (e) {
          if ((e as { code?: string }).code === '23505') throw new Error(`Storage key already exists: ${k}`); // like the folder's 'wx'
          throw e;
        }
      },
      async get(key) {
        const r = await pool.query<{ bytes: Buffer }>('select bytes from app.file_store where key = $1', [safeKey(key)]);
        if (!r.rows[0]) throw new Error(`Stored file not found: ${key}`);
        return r.rows[0].bytes;
      }
    };
  }
  if (cfg.STORAGE_MODE === 'azure') {
    const container = new BlobServiceClient(cfg.STORAGE_ACCOUNT_URL, new DefaultAzureCredential()).getContainerClient(cfg.STORAGE_CONTAINER);
    return {
      async put(key, bytes, contentType) {
        await container.getBlockBlobClient(safeKey(key)).uploadData(Buffer.from(bytes), { blobHTTPHeaders: { blobContentType: contentType } });
      },
      async get(key) { return container.getBlockBlobClient(safeKey(key)).downloadToBuffer(); }
    };
  }
  const root = cfg.LOCAL_STORAGE_DIR;
  return {
    async put(key, bytes) { const p = join(root, safeKey(key)); await mkdir(dirname(p), { recursive: true }); await writeFile(p, bytes, { flag: 'wx' }); },
    async get(key) { return readFile(join(root, safeKey(key))); }
  };
}
