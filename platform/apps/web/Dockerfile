# syntax=docker/dockerfile:1
# VeQMS web image (Next.js standalone output). Build from the platform/ folder:
#   docker build -f apps/web/Dockerfile -t veqms-web .
# Assumes next.config sets output: 'standalone' and outputFileTracingRoot to the platform/ folder, so the
# standalone server is at .next/standalone/apps/web/server.js. If not, adjust the paths in the runtime stage.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages/domain packages/domain
COPY apps/web apps/web
# public/ may not exist yet; create it so the COPY in the runtime stage always works.
RUN mkdir -p apps/web/public \
 && npm run build --workspace @veqms/domain \
 && npm run build --workspace @veqms/web

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
