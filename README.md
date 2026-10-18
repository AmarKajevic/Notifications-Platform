# Notification Platform

Event-driven notification delivery system. A gateway API accepts notification requests, persists them, and reliably hands them off to Kafka for asynchronous delivery by independent workers — built to demonstrate operating an event-driven system correctly (no lost events, no duplicate sends, automatic retries), not just wiring one up. A React dashboard (`frontend/`) sits on top for sending notifications and watching them move through their lifecycle, and the full stack runs the same way in Docker Compose, raw Kubernetes manifests, or a Helm chart with Kafka-lag-based autoscaling (KEDA).

For a line-by-line walkthrough of every file and every design decision, see [docs/DOKUMENTACIJA-PROJEKTA.md](docs/DOKUMENTACIJA-PROJEKTA.md) (or [docs/PROJEKAT-OBJASNJENO.md](docs/PROJEKAT-OBJASNJENO.md) for a plain-language version, in Serbian).

## Architecture

```mermaid
flowchart LR
    UI["React dashboard"] -->|"REST"| Gateway
    Client(["Client"]) -->|"POST /api/notifications"| Gateway["Gateway API (NestJS)"]
    Gateway <-->|"rate limit +<br/>idempotency key"| Redis[("Redis")]

    subgraph tx["single DB transaction"]
        direction TB
        N["Notification row<br/>status = PENDING"]
        O["OutboxEvent row<br/>status = PENDING"]
    end

    Gateway --> tx
    tx --> DB[(Postgres)]

    Relay["Outbox Relay<br/>(inside gateway, polls every 2s)"] -->|"claim batch<br/>FOR UPDATE SKIP LOCKED"| DB
    Relay -->|publish| Kafka[("Kafka<br/>notification.requested")]

    Kafka --> EmailWorker["email-worker"]
    Kafka --> WebhookWorker["webhook-worker"]
    EmailWorker -->|SMTP| Mail["Mailpit / SMTP server"]
    WebhookWorker -->|"HTTP POST"| Hook["Customer webhook"]

    EmailWorker -->|"status, attempts,<br/>nextRetryAt"| DB
    WebhookWorker -->|"status, attempts,<br/>nextRetryAt"| DB

    Scheduler["retry-scheduler<br/>(cron, every 2s)"] -->|"re-queue due RETRYING<br/>as a new OutboxEvent"| DB
```

The gateway never talks to Kafka on the request path. It writes the `Notification` and a matching `OutboxEvent` in one transaction and returns; the relay is the only thing that publishes to Kafka. Workers consume the topic independently (each channel has its own consumer group), deliver, and record the outcome in Postgres. Failed deliveries are re-queued by `retry-scheduler` through the same outbox, so there is exactly one path onto Kafka.

## Current status

| Phase | Scope                                                                         | Status  |
| ----- | ----------------------------------------------------------------------------- | ------- |
| 0     | Local infra (Docker Compose: Kafka, Redis, Mailpit; Postgres)                 | ✅      |
| 1     | Gateway API + transactional outbox + relay                                    | ✅      |
| 2     | `email-worker` + retries with exponential backoff (`retry-scheduler`)         | ✅      |
| 3     | `webhook-worker`, Redis idempotency keys, rate limiting                       | ✅      |
| 4     | Containerize all services (Dockerfiles, full-stack compose, health endpoints) | ✅      |
| 5     | Kubernetes (raw manifests + Helm chart, health probes, resource limits)       | ✅      |
| 6     | Autoscaling with KEDA (scale workers on Kafka consumer lag)                   | ✅      |
| 7     | React admin dashboard (`frontend/`)                                           | ✅      |
| 8     | CI (lint, unit tests, build, typecheck on every push/PR)                      | ✅      |
| 9     | Observability (Prometheus + Grafana)                                          | planned |
| 10    | CD (build/push images, deploy from CI)                                        | planned |

## How a notification flows

1. **Accept.** `POST /api/notifications` is rate-limited per tenant, optionally de-duplicated by `Idempotency-Key`, validated, and written (`Notification` + `OutboxEvent`) in one transaction.
2. **Publish.** The outbox relay claims pending events and publishes them to Kafka topic `notification.requested`.
3. **Deliver.** `email-worker` / `webhook-worker` pick up events for their channel (each ignores the other's), mark the notification `PROCESSING`, attempt delivery, and mark it `DELIVERED`.
4. **Retry.** On failure the worker records the error and schedules the next attempt with exponential backoff (1s, 2s, 4s, 8s, 16s + up to 500ms jitter). `retry-scheduler` re-queues due notifications. After 6 failed attempts the notification is marked `FAILED`.

```
PENDING → PROCESSING → DELIVERED
              ↓
          RETRYING → (retry-scheduler) → PENDING → PROCESSING → ...
              ↓  (6th failure)
           FAILED
```

## Why these decisions

### Why the outbox pattern

Writing to Postgres and publishing to Kafka are two separate systems — there's no way to commit both atomically. Publishing directly from the request handler (write DB → call Kafka) means a crash or broker hiccup between those two steps silently drops the event forever, even though the client already got a success response.

The outbox pattern writes the event to an `OutboxEvent` table in the **same transaction** as the domain write, so it's committed atomically with the `Notification` row. A separate `OutboxRelayService` polls for `PENDING` rows and publishes them to Kafka, retrying on failure (`attempts` + `lastError` tracked per row, capped and marked `FAILED` after 10 attempts). Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED`, so this is safe to run from multiple gateway replicas without double-publishing — a deliberate choice ahead of the Kubernetes phase.

### Why idempotency is two-layered

Kafka delivers at-least-once, and HTTP clients retry on timeouts, so duplicates can appear at two different places:

- **At the API (client retries).** If a request carries an `Idempotency-Key` header, the gateway reserves the key in Redis (`SET NX`, 24h TTL) before touching the database. A repeat of the same key returns the original response instead of creating a second notification. If Redis still says "processing" but the process crashed after committing, the gateway checks Postgres for the row before answering, so a legitimately created notification is never reported as a conflict.
- **At the workers (Kafka redelivery).** A worker checks the notification's status first and skips anything already `DELIVERED`, so a redelivered event can't send a second email.

### Why retries are driven by the database, not by Kafka

Blocking a Kafka partition while a worker sleeps between attempts stalls every message behind it, and Kafka has no native delayed redelivery. Instead the worker stores `status = RETRYING` and `nextRetryAt` in Postgres and moves on; `retry-scheduler` re-queues due rows through the outbox. The claim is a conditional `UPDATE ... WHERE status = 'RETRYING'`, so running several schedulers can't enqueue the same retry twice.

### Why Kafka

Chosen for partitioned, replayable, ordered-per-key delivery to multiple independent consumer groups (email and webhook workers now, more channels later) — a better fit than a traditional queue for a system expected to grow more consumer types over time.

### Why Nx + pnpm workspaces

Each deployable (`gateway`, `email-worker`, `webhook-worker`, `retry-scheduler`) is its own app, and `libs/*` are separate buildable packages so every service shares the same Kafka client, database client, Redis client and event contracts without duplicating code.

## Event schema

```ts
interface NotificationRequestedEvent {
  eventId: string;
  notificationId: string;
  tenantId: string;
  channel: 'EMAIL' | 'WEBHOOK';
  recipient: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
```

Defined in `libs/contracts` so the producer and every consumer share the same type.

## Dashboard

`frontend/` is a React (Vite, React Router v7 in SPA mode) admin UI for the gateway's API — no separate backend of its own, it's a pure REST client. Three pages:

- **Dashboard** (`/`) — live counts per status and the 10 most recent notifications.
- **Send** (`/send`) — a form for both channels (subject/body for email, raw JSON for webhooks); each send is tracked live on the same page, polling `GET /api/notifications/:id` every second until it reaches `DELIVERED` or `FAILED`.
- **Notifications** (`/notifications`) — the full history, filterable by status and channel, paginated.

All three auto-refresh (3–4s) against the gateway's REST API — there's no websocket/SSE push, which is the one corner cut here for simplicity. In dev it talks to `VITE_API_URL` directly (CORS-enabled on the gateway for this, see `Configuration` below); the Docker image instead bakes in `/api` and lets nginx reverse-proxy that to the gateway container, so the same built image works unmodified in Compose and in Kubernetes (`frontend/nginx.conf`).

## API

### `POST /api/notifications`

```sh
curl -X POST http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1234-confirmation" \
  -d '{"channel":"EMAIL","recipient":"user@example.com","payload":{"subject":"Hello","body":"Welcome"}}'
```

| Field       | Notes                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------ |
| `channel`   | `EMAIL` or `WEBHOOK`                                                                       |
| `recipient` | an email address for `EMAIL`, a URL for `WEBHOOK`                                          |
| `payload`   | for `EMAIL`: optional `subject` / `body`; for `WEBHOOK`: sent as the JSON body of the POST |

Response: `201 {"id": "...", "status": "PENDING"}` — the notification is accepted, not yet delivered. `Idempotency-Key` is optional.

| Status | Meaning                                                            |
| ------ | ------------------------------------------------------------------ |
| `400`  | validation failed                                                  |
| `409`  | same `Idempotency-Key` is still being processed by another request |
| `429`  | rate limit exceeded (100 requests per minute per tenant)           |

### `GET /api/notifications`

Paginated, filterable list — what the dashboard's history page calls.

```sh
curl "http://localhost:3000/api/notifications?status=DELIVERED&channel=EMAIL&page=1&pageSize=20"
```

All query params are optional. Response: `{"data": [...], "total": 42, "page": 1, "pageSize": 20}`, newest first.

### `GET /api/notifications/:id`

A single notification's current state — what the dashboard polls after sending one, to watch it move from `PENDING` to `DELIVERED`/`FAILED` live. `404` if it doesn't exist (or belongs to a different tenant).

### `GET /api/notifications/stats`

Counts per status (`{"PENDING": 1, "PROCESSING": 0, "RETRYING": 0, "DELIVERED": 40, "FAILED": 1}`) — what the dashboard's summary cards show.

## Getting started

**Prerequisites:** Node 22+, pnpm, Docker, and a reachable Postgres instance.

```sh
cp .env.example .env    # then fill in DATABASE_URL
pnpm install
pnpm exec prisma migrate dev
```

### Option A — everything in containers

Builds and runs all five services (including the dashboard) alongside Kafka, Redis and Mailpit:

```sh
docker compose -f docker-compose.prod.yml up --build
```

The first build downloads all dependencies inside the images and takes several minutes; later builds reuse the layer cache. `DATABASE_URL` is read from `.env`; the other connection settings are set in the compose file because containers reach each other by service name, not `localhost`. Don't run this alongside the dev compose file below — they share container names and ports. Dashboard is at <http://localhost:8080> (nginx reverse-proxies its `/api` calls to the gateway container — see `frontend/nginx.conf`).

### Option B — infra in Docker, services on your machine

Better for day-to-day development (fast rebuilds, debugger):

```sh
docker compose up -d          # Kafka, Redis, Mailpit
pnpm nx serve gateway         # each in its own terminal
pnpm nx serve email-worker
pnpm nx serve webhook-worker
pnpm nx serve retry-scheduler
pnpm nx serve frontend        # dashboard at http://localhost:4200
```

If a worker crashes on its very first start with `This server does not host this topic-partition`, the topic didn't exist yet — start the gateway first (or create `notification.requested`) and restart the worker.

### Try it

- Open the dashboard at <http://localhost:4200>, go to **Send**, and submit an email notification — watch it move from `PENDING` to `DELIVERED` live, then check **Notifications** for the full history.
- Or send the `curl` request above directly, then open Mailpit at <http://localhost:8025> to see the delivered email.
- Send it twice with the same `Idempotency-Key` — both calls return the same `id`.
- Stop Mailpit (`docker stop notification-mailpit`), send a notification, then start it again — the notification goes `RETRYING` with growing backoff and ends up `DELIVERED`.
- For webhooks, use a public echo endpoint such as <https://webhook.site> as `recipient`.

### Troubleshooting

- **Some services stuck at `Created`, never actually start.** Usually stale state from a previous `up` — e.g. the one-shot `kafka-data-init`/`kafka-topics-init` containers from an earlier run still exist but reference a Docker network that no longer does, so they fail immediately and everything that `depends_on` them (`kafka` → `kafka-topics-init` → `gateway`/`email-worker`/`webhook-worker`) never gets past "created". Fix: `docker compose -f docker-compose.prod.yml down` (clears this project's containers and network) then `up --build` again — don't just re-run `up` on top of the broken state.
- **Dashboard loads but every page errors / shows nothing.** Open devtools → Network and check what `/api/...` calls actually return. If you get HTML or an unexpected JSON shape back, the gateway container itself may not be healthy yet (`docker compose -f docker-compose.prod.yml ps`) — give it a few more seconds, Postgres/Kafka connections take a moment on first boot.

## Configuration

| Variable        | Used by               | Default / example                                                                            |
| --------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `DATABASE_URL`  | all services          | `postgresql://user:password@host:5432/database`                                              |
| `KAFKA_BROKERS` | gateway, both workers | `localhost:9092` (comma-separated)                                                           |
| `REDIS_URL`     | gateway               | `redis://localhost:6379`                                                                     |
| `SMTP_HOST`     | email-worker          | `localhost`                                                                                  |
| `SMTP_PORT`     | email-worker          | `1025`                                                                                       |
| `SMTP_FROM`     | email-worker          | `notifications@local.test`                                                                   |
| `PORT`          | gateway               | `3000`                                                                                       |
| `HEALTH_PORT`   | workers, scheduler    | `3001` / `3002` / `3003` (email / webhook / retry-scheduler)                                 |
| `CORS_ORIGIN`   | gateway               | `http://localhost:4200` (comma-separated; the dashboard's dev server)                        |
| `VITE_API_URL`  | frontend (build-time) | `http://localhost:3000/api`; baked to `/api` in the Docker image (see `frontend/nginx.conf`) |

## Health checks

Every service exposes a liveness and a readiness endpoint, intended for Kubernetes probes (and used by the `healthcheck` blocks in `docker-compose.prod.yml`). The workers and the scheduler have no public API, so they run a small HTTP listener on `HEALTH_PORT` purely for this.

| Service           | Liveness                                    | Readiness (`503` + JSON detail when failing)                | Port |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------- | ---- |
| `gateway`         | `GET /api/health`                           | `GET /api/health/ready` — Postgres and Redis reachable      | 3000 |
| `email-worker`    | `GET /health`                               | `GET /ready` — Kafka consumer joined its group, Postgres up | 3001 |
| `webhook-worker`  | `GET /health`                               | `GET /ready` — Kafka consumer joined its group, Postgres up | 3002 |
| `retry-scheduler` | `GET /health` — cron ticked in the last 30s | `GET /ready` — Postgres reachable                           | 3003 |

Two deliberate choices:

- **Liveness never checks external dependencies.** Restarting a pod can't fix a database outage, and doing it anyway would turn one outage into a crash loop across every service.
- **The gateway's readiness does not include Kafka.** The outbox exists so requests keep being accepted while the broker is down; taking the gateway out of rotation for that would defeat the point.

```sh
curl http://localhost:3000/api/health/ready
# {"status":"ok","checks":{"database":"up","redis":"up"}}
```

## Project structure

```
gateway/           HTTP API: validation, rate limiting, idempotency, outbox write + relay
email-worker/      Kafka consumer: sends email, records outcome, schedules retries
webhook-worker/    Kafka consumer: POSTs to webhook URLs, records outcome, schedules retries
retry-scheduler/   Cron process: re-queues notifications whose retry time has come
frontend/          React (Vite + React Router) admin dashboard — send + monitor notifications
libs/contracts/    Shared event types
libs/kafka/        Kafka producer client + shared consumer options
libs/database/     Prisma client + schema (Notification, OutboxEvent)
libs/redis/        Redis client wrapper (idempotency, rate limiting)
prisma/            Schema and migrations
infra/k8s/         Raw Kubernetes manifests (one folder per service)
infra/helm/        Helm chart — same deployment, parametrized, + KEDA ScaledObjects
docs/              Full technical write-up and a plain-language version (Serbian)
```

## Testing

```sh
pnpm nx run-many -t lint,typecheck,test,build
```

CI (`.github/workflows/ci.yml`) runs exactly this (plus `format:check`) on every push and PR. `e2e` is deliberately not in that list — those projects need a live Postgres/Kafka/Redis stack the CI runner doesn't provide, and are still Nx-generated boilerplate rather than real scenarios (see [docs/DOKUMENTACIJA-PROJEKTA.md](docs/DOKUMENTACIJA-PROJEKTA.md) §6).

## Known limitations

- **Worker readiness is set once, at startup.** A worker reports ready after its Kafka consumer first joins the group; if kafkajs later loses the connection and restarts the consumer internally, `/ready` doesn't flip back. Consumer lag (which the KEDA ScaledObjects already watch) is the better signal for a stuck consumer.
- **Single hardcoded tenant** (`demo-tenant`); there is no authentication, so rate limiting and idempotency keys are scoped to that one tenant — and the dashboard has no login, it's a trusted-network admin tool.
- **Docker images are large (~800 MB).** Each ships the whole workspace `node_modules` (dev dependencies pruned) instead of a per-service minimal install. Nx's `prune` target could shrink the three workers, but `gateway` has no `package.json` of its own, so it can't use it without first becoming a proper workspace package. (The frontend image is the exception — static nginx, ~50 MB.)
- **Dashboard polls rather than pushes.** `/notifications`, the dashboard, and a tracked send all re-fetch on a timer (3–4s, 1s while tracking a send) instead of a websocket/SSE connection — simpler, and plenty responsive at this scale, but it means up to a few seconds of staleness and N clients produce N× the polling load.
