// The Fastify app: health checks, the signed-in API under /api/v1, the Adobe Sign webhooks webhook and SCIM.
// Every /api/v1 request is authenticated first, then runs in one database transaction with the tenant and user set.
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { withTenant, type Db, type Pool } from '@veqms/db';
import type { Config } from './config.ts';
import type { ESign } from './integrations/adobesign.ts';
import type { Storage } from './integrations/storage.ts';
import { createAuthenticator, getAuth, setAuth, type Auth } from './lib/auth.ts';
import { forbidden, HttpError, toHttp } from './lib/http.ts';
import { audit } from './lib/work.ts';
import { isReadOnly } from '@veqms/domain';
import type { Person } from './lib/people.ts';
import { coreRoutes } from './routes/core.ts';
import { documentRoutes } from './routes/documents.ts';
import { closureRoutes } from './routes/closures.ts';
import { agreementRoutes } from './routes/agreements.ts';
import { trainingRoutes } from './routes/training.ts';
import { reportRoutes } from './routes/reports.ts';
import { adminRoutes } from './routes/admin.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { scimRoutes } from './routes/scim.ts';

// inbox: the webhook queue worker (services/inbox.ts). Optional, so tests can drain the queue themselves.
export interface AppDeps { cfg: Config; pool: Pool; esign: ESign; storage: Storage; inbox?: { kick(): void } }
export type Run = <T>(req: FastifyRequest, fn: (db: Db, me: Person, auth: Auth) => Promise<T>) => Promise<T>;
export interface Ctx extends AppDeps { run: Run }

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.cfg.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers["x-dev-user"]', 'req.headers.cookie'] },
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true
  });
  const authenticate = createAuthenticator(deps.cfg, deps.pool);
  // The browser never calls the API: the web app does, and passes on the person's IP address and device in
  // X-VeQMS-Client-IP and X-VeQMS-User-Agent. Without them (direct calls), the caller's own address is recorded.
  const header = (req: FastifyRequest, name: string) => { const v = req.headers[name]; return typeof v === 'string' && v ? v : null; };
  const run: Run = (req, fn) => {
    const a = getAuth(req);
    return withTenant(deps.pool, { tenantId: a.tenantId, userId: a.user.id, clientIp: header(req, 'x-veqms-client-ip') ?? req.ip, userAgent: header(req, 'x-veqms-user-agent') ?? header(req, 'user-agent') },
      (db) => fn(db, a.user, a));
  };
  const ctx: Ctx = { ...deps, run };

  app.setErrorHandler(async (err, req, reply) => {
    const h = toHttp(err);
    if (h.status >= 500) req.log.error({ err }, 'request failed');
    const note = err instanceof HttpError ? err.log : undefined;
    if (note) {
      try {
        const a = getAuth(req);
        await withTenant(deps.pool, { tenantId: a.tenantId, userId: a.user.id }, (db) => audit(db, note.action, note.objectType, note.objectId, note.summary));
      } catch (e) { req.log.error({ err: e }, 'could not write the audit entry for a refusal'); }
    }
    return reply.status(h.status).send(h.body);
  });

  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async () => { await deps.pool.query('select 1'); return { ok: true }; });

  app.register(async (api) => {
    api.addHook('onRequest', async (req) => {
      const a = await authenticate(req.headers);
      // The auditor role is read-only everywhere: refuse any change before it reaches a route.
      if (req.method !== 'GET' && req.method !== 'HEAD' && !/\/notifications\/[^/]+\/read$/.test(req.url) && isReadOnly(a.user.roles)) throw forbidden('Your role is read-only.');
      setAuth(req, a);
    });
    coreRoutes(api, ctx);
    documentRoutes(api, ctx);
    closureRoutes(api, ctx);
    agreementRoutes(api, ctx);
    trainingRoutes(api, ctx);
    reportRoutes(api, ctx);
    adminRoutes(api, ctx);
  }, { prefix: '/api/v1' });

  app.register(async (hooks) => webhookRoutes(hooks, ctx));
  app.register(async (scim) => scimRoutes(scim, ctx), { prefix: '/scim/v2' });
  return app;
}
