// File storage for agreement PDFs, signed PDFs and audit reports.
// Azure: a Blob container with versioning and a time-based immutability policy (see infra). Local: a folder.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
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

export function createStorage(cfg: Config): Storage {
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
