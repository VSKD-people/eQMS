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
}

export function createPool(cfg: DbConfig): Pool {
  return new pg.Pool({
    connectionString: cfg.connectionString,
    max: cfg.max ?? 10,
    ssl: cfg.ssl ? { rejectUnauthorized: true } : undefined,
    password: cfg.password,
    application_name: 'veqms-api'
  });
}

export interface TxContext {
  tenantId: string;
  userId: string | null; // null for system work (webhooks, scheduled jobs)
}

export async function withTenant<T>(pool: Pool, ctx: TxContext, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [ctx.tenantId, ctx.userId ?? '']);
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

export class NotFound extends Error {
  constructor(message = 'Not found') { super(message); this.name = 'NotFound'; }
}

// Database rule violations raised by our triggers use SQLSTATE P0001-P0003. Turn them into 409/403 for the API.
export function ruleViolation(e: unknown): { status: number; message: string } | null {
  const err = e as { code?: string; message?: string };
  if (err.code === 'P0001') return { status: 409, message: err.message ?? 'Not allowed' };
  if (err.code === 'P0002') return { status: 409, message: err.message ?? 'DocuSign allowance used up' };
  if (err.code === 'P0003') return { status: 403, message: err.message ?? 'Not allowed' };
  if (err.code === '42501') return { status: 403, message: 'Not allowed' };
  if (err.code === '23505') return { status: 409, message: 'That already exists' };
  if (err.code === '23514') return { status: 400, message: 'A required check failed: ' + (err.message ?? '') };
  return null;
}
