// HTTP errors with plain-English messages, and the shared error handler.
import { ZodError } from 'zod';
import { NotFound, ruleViolation } from '@veqms/db';

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code ?? ({ 400: 'bad_request', 401: 'unauthorised', 403: 'forbidden', 404: 'not_found', 409: 'conflict' } as Record<number, string>)[status] ?? 'error';
  }
}
export const badRequest = (m: string) => new HttpError(400, m);
export const forbidden = (m = 'You don’t have permission to do that.') => new HttpError(403, m);
export const notFound = (m = 'Not found.') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export function toHttp(e: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (e instanceof HttpError) return { status: e.status, body: { error: { code: e.code, message: e.message } } };
  if (e instanceof NotFound) return { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
  if (e instanceof ZodError) return { status: 400, body: { error: { code: 'bad_request', message: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') } } };
  const rule = ruleViolation(e);
  if (rule) return { status: rule.status, body: { error: { code: rule.status === 403 ? 'forbidden' : 'conflict', message: rule.message } } };
  const status = (e as { statusCode?: number }).statusCode;
  if (status && status >= 400 && status < 500) return { status, body: { error: { code: 'bad_request', message: (e as Error).message } } };
  return { status: 500, body: { error: { code: 'error', message: 'Something went wrong. It has been logged.' } } };
}
