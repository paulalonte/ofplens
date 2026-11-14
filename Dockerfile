# syntax=docker/dockerfile:1
#
# Container images for OFP Lens, built from the repo root:
#
#   docker build --target api -t ofplens-api .   # the API (also runs the migrations)
#   docker build --target web -t ofplens-web .   # the web app, served by nginx
#
# Multi-stage: the build stages have pnpm, TypeScript and the full source; the final images
# have only what runs (docs/LEARNING.md, step 1).

ARG NODE_IMAGE=node:24.22.2-slim
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.6-alpine

# ---- Dependencies: downloaded from the lockfile alone, so this layer is cached until it changes
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    npm_config_store_dir=/pnpm/store
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile

# ---- Source, installed offline from the fetched store
FROM deps AS source
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline

FROM source AS api-build
RUN pnpm --filter @ofplens/api build

FROM source AS web-build
RUN pnpm --filter @ofplens/web build

# ---- API: one bundled file per command, no node_modules, runs as the unprivileged node user (1000)
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=api-build --chown=root:root /repo/apps/api/dist ./dist
COPY --from=api-build --chown=root:root /repo/packages/db/migrations ./migrations
# The "node" user, by number: Kubernetes' runAsNonRoot can only verify a numeric user is not root.
USER 1000:1000
EXPOSE 3000
# The migration Job runs the same image with: node dist/migrate.js
CMD ["node", "--enable-source-maps", "dist/server.js"]

# ---- Web: the static build behind nginx, which also forwards /api to the API
FROM ${NGINX_IMAGE} AS web
ENV API_UPSTREAM=http://api:3000
COPY deploy/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=web-build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
