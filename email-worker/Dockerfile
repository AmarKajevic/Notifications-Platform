# syntax=docker/dockerfile:1
#
# Build context must be the repo root, e.g.:
#   docker build -f email-worker/Dockerfile -t notification-email-worker .
#
# email-worker does have its own package.json, so Nx can normally produce a
# minimal, self-contained deploy folder via `nx run email-worker:prune`
# (build + prune-lockfile + copy-workspace-modules). That target is currently
# broken in this workspace two different ways: the Nx project graph doesn't
# consistently resolve the prune-lockfile/copy-workspace-modules targets for
# every worker app, and even where it does, the pruned pnpm-lock.yaml ships a
# broken path for local workspace deps (`local_path_modules/workspace_modules/...`
# instead of `workspace_modules/...`), which fails a `--frozen-lockfile`
# install. Rather than depend on that, this uses the same full-install +
# `pnpm prune --prod` approach as gateway's Dockerfile — larger image, but
# reliable. Revisit once the Nx prune tooling is fixed upstream.

FROM node:22-alpine AS build
WORKDIR /app
# The Nx daemon is built for long-running dev sessions with file-watching;
# in a one-shot container build it just adds IPC overhead and has been
# observed to time out entirely, so disable it here (standard for CI/Docker).
ENV NX_DAEMON=false
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec nx build email-worker
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/libs ./libs
# email-worker is a real pnpm workspace member, so its own dependencies are
# symlinked from email-worker/node_modules (into the shared .pnpm store above)
# and not from the root node_modules.
COPY --from=build /app/email-worker/node_modules ./email-worker/node_modules
COPY --from=build /app/email-worker/dist ./email-worker/dist
COPY --from=build /app/package.json ./package.json

CMD ["node", "email-worker/dist/main.js"]
