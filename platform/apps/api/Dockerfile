# syntax=docker/dockerfile:1
# VeQMS API image. Build from the platform/ folder:
#   docker build -f apps/api/Dockerfile -t veqms-api .
# The same image runs the API, the migration job (packages/db/dist/migrate.js) and the reminders job.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- 1. Install all dependencies (workspace manifests only, so this layer caches well) ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# npm ci needs package-lock.json. Commit the lockfile after the first `npm install`; until then this falls back.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ---- 2. Build domain, db and api ----
FROM deps AS build
COPY packages packages
COPY apps/api apps/api
RUN npm run build --workspace @veqms/domain \
 && npm run build --workspace @veqms/db \
 && npm run build --workspace @veqms/api

# ---- 3. Production dependencies only ----
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Installs production dependencies for every workspace (including the web app's). A later optimisation is to
# prune to the API's dependency tree only.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---- 4. Runtime ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=build --chown=node:node /app/packages/domain/dist ./packages/domain/dist
COPY --from=build --chown=node:node /app/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=node:node /app/packages/db/dist ./packages/db/dist
COPY --from=build --chown=node:node /app/packages/db/migrations ./packages/db/migrations
COPY --from=build --chown=node:node /app/packages/db/seed ./packages/db/seed
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node infra/scripts/with-pg-token.mjs infra/scripts/grant-app-role.mjs ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
