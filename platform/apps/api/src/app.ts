// The Fastify app: health checks, the signed-in API under /api/v1, the Adobe Sign webhooks webhook and SCIM.
// Every /api/v1 request is authenticated first, then runs in one database transaction with the tenant and user set.
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { withTenant, type Db, type Pool } from '@veqms/db';
import type { Config } from './config.ts';
import type { ESign } from './integrations/adobesign.ts';
import type { Storage } from './integrations/storage.ts';
import type { SharePoint } from './integrations/sharepoint.ts';
import { createAuthenticator, getAuth, setAuth, type Auth } from './lib/auth.ts';
import { forbidden, HttpError, toHttp } from './lib/http.ts';
import { audit } from './lib/work.ts';
import { isReadOnly } from '@veqms/domain';
import { z } from 'zod';
import * as localAuth from './services/local-auth.ts';
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
// publisher: publishes Effective versions to SharePoint (services/sharepoint.ts). Optional, like inbox.
export interface AppDeps { cfg: Config; pool: Pool; esign: ESign; storage: Storage; sharepoint: SharePoint; inbox?: { kick(): void }; publisher?: { kick(): void } }
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

  // Email and password sign-in (AUTH_MODE=local only). Called by the web app's server, never by the browser.
  app.post('/auth/local/login', async (req, reply) => {
    if (deps.cfg.AUTH_MODE !== 'local') return reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
    const b = z.object({ email: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) }).safeParse(req.body);
    if (!b.success) return reply.status(400).send({ error: { code: 'bad_request', message: 'Enter your email address and password.' } });
    const r = await localAuth.login(deps.pool, deps.cfg, b.data.email, b.data.password, { ip: header(req, 'x-veqms-client-ip') ?? req.ip, userAgent: header(req, 'x-veqms-user-agent') ?? header(req, 'user-agent') });
    if (!r.ok) return reply.status(401).send({ error: { code: 'sign_in_refused', message: r.message } });
    return r;
  });

  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async () => { await deps.pool.query('select 1'); return { ok: true }; });

  app.register(async (api) => {
    api.addHook('onRequest', async (req) => {
      const a = await authenticate(req.headers);
      // A temporary password: nothing but reading who you are and changing it, until it is changed.
      if (a.mustChange && !['/api/v1/me', '/api/v1/auth/password'].includes(req.url.split('?')[0]!)) throw forbidden('Change your temporary password first.');
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
