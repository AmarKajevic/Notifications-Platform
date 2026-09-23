# syntax=docker/dockerfile:1
#
# Build context must be the repo root, e.g.:
#   docker build -f gateway/Dockerfile -t notification-gateway .
#
# gateway has no package.json of its own (it draws its dependencies from the
# root package.json), so unlike the worker services it can't use Nx's
# per-project `prune` target. Instead we do a full workspace install, build,
# then strip devDependencies in place with `pnpm prune --prod` and copy only
# what's needed (node_modules, the built bundle, and libs/ — node_modules/@org/*
# are symlinks into libs/*, so libs/* has to ship alongside node_modules).

FROM node:22-alpine AS build
WORKDIR /app
# The Nx daemon is built for long-running dev sessions with file-watching;
# in a one-shot container build it just adds IPC overhead and has been
# observed to time out entirely, so disable it here (standard for CI/Docker).
ENV NX_DAEMON=false
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec nx build gateway
RUN pnpm prune --prod

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/libs ./libs
COPY --from=build /app/dist/gateway ./dist/gateway
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
CMD ["node", "dist/gateway/main.js"]
