# syntax=docker/dockerfile:1
#
# Build context must be the repo root, e.g.:
#   docker build -f webhook-worker/Dockerfile -t notification-webhook-worker .
#
# See email-worker/Dockerfile for why this doesn't use Nx's `prune` target
# (it's currently unreliable for this project in this workspace) and uses a
# full install + `pnpm prune --prod` instead.

FROM node:22-alpine AS build
WORKDIR /app
# See gateway/Dockerfile for why NX_DAEMON is disabled here.
ENV NX_DAEMON=false
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec nx build webhook-worker
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/libs ./libs
# See email-worker/Dockerfile: workspace members resolve their own deps from
# <member>/node_modules, which has to ship alongside the shared .pnpm store.
COPY --from=build /app/webhook-worker/node_modules ./webhook-worker/node_modules
COPY --from=build /app/webhook-worker/dist ./webhook-worker/dist
COPY --from=build /app/package.json ./package.json

CMD ["node", "webhook-worker/dist/main.js"]
