// Request parsing with zod. Route params, query strings and bodies arrive untyped and are checked here.
import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import { forbidden } from './http.ts';
import { can, type Permission } from '@veqms/domain';
import type { Person } from './people.ts';

export { z };
export const uuid = z.string().uuid();
export const number = z.string().regex(/^[A-Z]{2,5}-\d{1,6}$/, 'Not a record number');

export function param<T extends z.ZodRawShape>(shape: T, v: unknown): z.infer<z.ZodObject<T>> { return z.object(shape).parse(v); }
export function query<T extends z.ZodRawShape>(shape: T, v: unknown): z.infer<z.ZodObject<T>> { return z.object(shape).parse(v ?? {}); }
export function body<T extends z.ZodTypeAny>(schema: T, v: unknown): z.infer<T> { return schema.parse(v ?? {}); }

export function need(me: Person, perm: Permission): void {
  if (!can(me.roles, perm)) throw forbidden();
}

export function pdf(reply: FastifyReply, bytes: Uint8Array, name: string) {
  return reply.type('application/pdf').header('content-disposition', `inline; filename="${name.replace(/[^\w.-]/g, '_')}"`).header('cache-control', 'no-store').send(Buffer.from(bytes));
}
export function download(reply: FastifyReply, bytes: Uint8Array, name: string, type: string) {
  return reply.type(type).header('content-disposition', `attachment; filename="${name.replace(/[^\w.-]/g, '_')}"`).header('cache-control', 'no-store').send(Buffer.from(bytes));
}
export const noContent = (reply: FastifyReply) => reply.code(204).send();
