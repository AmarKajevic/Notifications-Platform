# syntax=docker/dockerfile:1
#
# Build context must be the repo root, e.g.:
#   docker build -f frontend/Dockerfile -t notification-frontend .
#
# Static SPA build (react-router.config.ts sets ssr: false) served by nginx —
# no Node runtime needed at all in the final image, unlike the other 3
# services. See nginx.conf for why VITE_API_URL is baked in as "/api" here:
# it's what lets the same image work in both Docker Compose and Kubernetes.

FROM node:22-alpine AS build
WORKDIR /app
ENV NX_DAEMON=false
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ENV VITE_API_URL=/api
RUN pnpm exec nx build frontend

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/frontend/build/client /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Fill in nginx.conf's RESOLVER_IP placeholder from this container's actual
# DNS server (whatever /etc/resolv.conf says — Docker's embedded resolver or
# the cluster's CoreDNS, depending where this image ends up running) before
# starting nginx. Done at container start, not at build time, since the
# right resolver address isn't known until then. See nginx.conf for why this
# is needed at all.
CMD ["/bin/sh", "-c", "sed -i \"s/RESOLVER_IP/$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf)/\" /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
