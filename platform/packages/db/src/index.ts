// Connection helpers. Every API request runs in one transaction with the tenant and the acting user set, so
// row-level security, the audit triggers and the training-record rules all see who is acting.
import pg from 'pg';
import type { Pool, PoolClient, QueryResultRow } from 'pg';

export type Db = PoolClient;
export type { Pool };

export interface DbConfig {
  connectionString: string;
  max?: number;
  ssl?: boolean;
  // Azure Database for PostgreSQL with Entra authentication: a function returning a fresh access token.
  password?: string | (() => Promise<string>);
  // Called when an idle connection fails (database restart, failover, or a connection closed by the server).
  onError?: (err: Error) => void;
}

export function createPool(cfg: DbConfig): Pool {
  const pool = new pg.Pool({
    connectionString: cfg.connectionString,
    max: cfg.max ?? 10,
    ssl: cfg.ssl ? { rejectUnauthorized: true } : undefined,
    password: cfg.password,
    application_name: 'veqms-api'
  });
  // Without a listener, an idle connection dropped by the server is an unhandled 'error' event and the process
  // exits. pg has already removed the broken connection; the next request opens a new one.
  pool.on('error', cfg.onError ?? ((err) => console.error('Database connection lost; it will be replaced:', err.message)));
  return pool;
}

export interface TxContext {
  tenantId: string;
  userId: string | null; // null for system work (webhooks, scheduled jobs)
  // The signed-in person's IP address and device, recorded once per request with its audit entries (app.audit).
  clientIp?: string | null;
  userAgent?: string | null;
}

export async function withTenant<T>(pool: Pool, ctx: TxContext, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true), set_config('app.client_ip', $3, true), set_config('app.user_agent', $4, true)",
      [ctx.tenantId, ctx.userId ?? '', ctx.clientIp ?? '', (ctx.userAgent ?? '').slice(0, 500)]);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function rows<T extends QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query<T>(sql, params);
  return r.rows;
}

export async function one<T extends QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  if (r.rowCount !== 1 || !r.rows[0]) throw new NotFound();
  return r.rows[0];
}

export async function maybe<T extends QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const r = await db.query<T>(sql, params);
  return r.rows[0] ?? null;
}

// One transaction is one connection, so per-row lookups run one after another. pg queues concurrent queries on a
// client today but has deprecated it (removed in pg 9), and it gives no speed-up on a single connection anyway.
export async function mapSeq<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (const item of items) out.push(await fn(item));
  return out;
}

export class NotFound extends Error {
  constructor(message = 'Not found') { super(message); this.name = 'NotFound'; }
}

// Database rule violations raised by our triggers use SQLSTATE P0001-P0003. Turn them into 409/403 for the API.
export function ruleViolation(e: unknown): { status: number; message: string } | null {
  const err = e as { code?: string; message?: string };
  if (err.code === 'P0001') return { status: 409, message: err.message ?? 'Not allowed' };
  if (err.code === 'P0002') return { status: 409, message: err.message ?? 'Adobe Sign allowance used up' };
  if (err.code === 'P0003') return { status: 403, message: err.message ?? 'Not allowed' };
  if (err.code === '42501') return { status: 403, message: 'Not allowed' };
  if (err.code === '23505') return { status: 409, message: 'That already exists' };
  if (err.code === '23514') return { status: 400, message: 'A required check failed: ' + (err.message ?? '') };
  return null;
}
