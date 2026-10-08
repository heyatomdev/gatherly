# Gatherly — Project Guide

## Purpose

Multi-tenant event management API. Clients (gyms, gaming orgs, etc.) call the API with a Bastion service-client JWT to create and manage events, categories, tags, and participants. Supports i18n (it/en or any locale), recurring events via iCal RRULE, and two participant types: inline (no external account) and external (linked to a third-party user ID).

---

## Stack

- **Runtime**: Node.js 24, TypeScript 6
- **Framework**: NestJS 11
- **ORM**: Prisma 7 + PostgreSQL
- **Package manager**: pnpm (enforced — `npm install` fails)
- **Validation**: class-validator + class-transformer (global ValidationPipe with whitelist + transform)
- **Docs**: Swagger at `/docs`
- **Scheduling**: `@nestjs/schedule` (cron jobs)
- **HTTP client**: `@nestjs/axios` (webhook delivery)

---

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL

pnpm install
pnpm prisma:migrate      # applies migrations
pnpm prisma:generate     # generates Prisma client
pnpm start:dev           # watch mode
```

### ENV vars

Validated at boot by `src/configs/config.validation.ts` (class-validator) —
defaults live there only; `main.ts` reads them through `ConfigService`.

| Var | Default | Required |
|-----|---------|----------|
| `DATABASE_URL` | — | Yes |
| `NODE_ENV` | `development` | No |
| `PORT` | `3000` | No |
| `CORS_ORIGINS` | `http://localhost:3000` (comma-separated) | No |
| `LOG_LEVEL` | `info` | No |
| `BASTION_URL` | — | Yes |
| `BASTION_APP_SLUG` | — | Yes |
| `BASTION_CLIENT_API_KEY` | — | Yes |
| `BASTION_TENANT_SLUG` | — | No (single-tenant only) |
| `BASTION_JWKS_TTL_MS` | `300000` | No |
| `THROTTLE_TTL_MS` | `60000` | No |
| `THROTTLE_LIMIT` | `100` | No |
| `ADMIN_ACCEPTED_APP_SLUGS` | `gatherly` | No (add `meridian`) |
| `ADMIN_ACCEPTED_ROLES` | `ADMIN,OWNER,SUPER_ADMIN,MODERATOR,AUTHOR` | No |
| `VIP_THRESHOLD` | `5` | No |
| `AT_RISK_DAYS` | `120` | No |

### Docker

```bash
docker build -t gatherly .
docker run -p 3000:3000 -e DATABASE_URL=... gatherly
```

### Useful scripts

```bash
pnpm start:dev        # dev with watch
pnpm build            # compile to dist/
pnpm prisma:studio    # Prisma GUI
pnpm prisma:migrate   # run migrations
pnpm lint             # ESLint fix
```

---

## Architecture

```
src/
  guards/
    admin-throttler.guard.ts # throttling for /admin/*
  configs/
    config.validation.ts     # env validation + defaults (class-validator)
  modules/
    prisma/                  # @Global PrismaService
    app/                     # root module
    bastion/                 # JWKS cache, BastionJwtGuard (global), BastionUserGuard, BastionSuperAdminGuard
    clients/                 # ClientService only — no controller, no self-service (see below)
    categories/              # EventCategory CRUD (i18n)
    events/                  # Event CRUD + participants + recurrence
    tags/                    # Tag CRUD (client-scoped)
    webhook/                 # WebhookService (outbox + delivery cron) + helper formatters
    admin/
      controllers/
        admin-clients.controller.ts  # /admin/clients — SUPER_ADMIN only, see below
```

**PrismaModule** is `@Global()` — never add `PrismaService` to `providers[]` in other modules.

---

## Auth

Machine-to-machine calls use a **Bastion service-client JWT**
(`Authorization: Bearer <jwt>`, RS256, from Bastion `POST /auth/client`).
`X-Client-Token` / `ClientAuthGuard` are gone — `Client.token` is still in the
schema but nothing reads it.

The global `BastionJwtGuard` (`src/modules/bastion/guards/bastion-jwt.guard.ts`,
`APP_GUARD`) on every non-`/admin`, non-`@Public()` route:
1. Requires `Authorization: Bearer ...`
2. Verifies signature/exp against Bastion JWKS (`BastionJwksService`, cached)
3. Looks up the `Client` by the token's `tenantId` (`@unique`); missing or
   `isActive === false` → `401`

Payload and client are attached as `req.user` / `req.client` — access in
controllers via `@Request() req`. Exclude a route with `@Public()`.

### Client management — no longer self-service

There used to be a public `ClientController` at `/clients` (`POST`/`GET` were
`@Public()`, the rest sat only behind the global `BastionJwtGuard`, which
checks signature + "token's tenant has an active client" but nothing about
role or which client id is being touched). That meant anyone could mint a
client bound to any Bastion `tenantId` and read its token, or any tenant's
token could modify/revoke/regenerate another tenant's client. It's gone.

Client CRUD now lives at `/admin/clients`, gated by `BastionSuperAdminGuard`
(`src/modules/bastion/guards/bastion-super-admin.guard.ts`) — SUPER_ADMIN
role only, no tenant/client lookup (deliberately: the first client on an
empty DB could never be created otherwise, and a SUPER_ADMIN manages clients
across tenants, not just their own). Created from Meridian → Gatherly →
Clients. No external app creates clients directly. `ClientModule` now only
exports `ClientService` — no controller, no routes of its own.

`ClientService` is still used by the per-tenant self-service admin routes
(`admin-settings.controller.ts`, `admin-webhooks.controller.ts`), which stay
behind `BastionUserGuard` and act on `req.adminClient` (the client bound to
the caller's own tenant) — that's a different guard and a different set of
routes from `/admin/clients`.

### ⚠️ `/admin/*` bypasses the global guard — every admin controller must gate itself

The global `BastionJwtGuard` (`src/modules/bastion/guards/bastion-jwt.guard.ts`,
registered as `APP_GUARD`) returns `true` for **every** path starting with
`/admin`, no exceptions — auth for the whole admin surface is deferred to
per-controller `@UseGuards(...)`. A new controller under `AdminModule` (or
any new controller mounted at `/admin/...`) that forgets its own guard is
**fully public**, no auth at all. Every admin controller today puts
`BastionUserGuard` (per-tenant) or `BastionSuperAdminGuard` (SUPER_ADMIN,
cross-tenant — currently only `admin-clients.controller.ts`) plus
`AdminThrottlerGuard` on the class. Adding the guard is part of the PR that
adds the controller, not a follow-up.

---

## Domain Model

### Client
Single API consumer (e.g. one gym, one gaming org). Has a unique token. Owns all other entities.

```
Client
  ├── events[]
  ├── eventCategories[]
  └── tags[]
```

### Event
Core entity. Translatable via `EventTranslation`. Tags via `EventTag` junction.

**i18n**: `title` and `description` live in `EventTranslation`, not on `Event` directly.
**Tags**: `tags String[]` is gone — use `EventTag` → `Tag`.
**Recurrence**: `RecurrenceRule` is a separate model. Parent event has `recurrenceRuleId`. Child events have `parentEventId`.

### Participant
Two types:
- `INLINE` — data provided directly (`userName`, `email`). No external account.
- `EXTERNAL` — linked to third-party user (`externalId` + `externalSource` e.g. `"discord"`).

Unique constraint: `[eventId, externalId, externalSource]` (prevents duplicate external registrations). INLINE participants are uniquely identified by their `id` only.

### Tag
Client-scoped slug (e.g. `"5v5"`, `"yoga"`). Optional `label Json` for localized display names: `{"it": "Competitivo", "en": "Competitive"}`. Tags are auto-created when referenced by slug in event create/update.

### RecurrenceRule
Extracted from Event. Holds the RRULE string + optional endDate + count. Shared across parent event and used to generate child event instances.

---

## Key Patterns

### Creating events (i18n + tags)

```json
POST /events
{
  "translations": [
    { "locale": "it", "title": "Torneo Gaming", "description": "..." },
    { "locale": "en", "title": "Gaming Tournament" }
  ],
  "defaultLocale": "it",
  "authorId": "user-123",
  "authorName": "Mario",
  "startTime": "2026-07-01T18:00:00Z",
  "tagSlugs": ["competitive", "5v5"],
  "recurrenceRule": "FREQ=WEEKLY;BYDAY=MO",
  "recurrenceCount": 10
}
```

`tagSlugs` auto-upserts Tags by slug for the client. `recurrenceRule` triggers `RecurrenceRule` creation + child event generation.

### Adding participants

INLINE (no external account):
```json
POST /events/:eventId/participants
{ "type": "INLINE", "userName": "Mario", "email": "mario@example.com" }
```

EXTERNAL (third-party user):
```json
{ "type": "EXTERNAL", "userName": "MarioGamer", "externalId": "discord-user-456", "externalSource": "discord" }
```

Domain-specific data via `metadata`:
```json
{ "userName": "Team A", "metadata": { "team": "Red", "seed": 3, "rank": "Diamond" } }
```

Waitlist is automatic: if `maxParticipants` reached, status becomes `WAITLIST`. Cancelling a participant promotes the first waitlisted.

### Updating tags on an event

```json
PATCH /events/:eventId
{ "tagSlugs": ["yoga", "beginner"] }
```

`tagSlugs` replaces all existing tags (delete + recreate). Pass `[]` to remove all tags.

### Updating translations

```json
PATCH /events/:eventId
{ "translations": [{ "locale": "en", "title": "Updated Title" }] }
```

Upserts by `(eventId, locale)` — existing locale is updated, new locale is created.

---

## API Endpoints

### Clients — `/admin/clients` (SUPER_ADMIN only, Bastion user JWT)

No more public `/clients` — see "Client management — no longer self-service" above.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/clients` | List all (token, webhookSecret excluded) |
| `POST` | `/admin/clients` | Create client — returns token once |
| `PATCH` | `/admin/clients/:id` | Update name/tenantId/locale/emailActive/webhookUrl |
| `POST` | `/admin/clients/:id/revoke` | Revoke — blocks all API calls |
| `POST` | `/admin/clients/:id/reactivate` | Reactivate a revoked client |
| `POST` | `/admin/clients/:id/token` | Regenerate token |
| `POST` | `/admin/clients/:id/webhook-secret` | Regenerate webhook HMAC secret |
| `GET` | `/admin/clients/:id/webhook-deliveries?status=` | Webhook delivery attempts |

`tenantId` is `@unique` on `Client` — a duplicate on create/update returns
`409 Conflict`, not a 500.

### Categories (auth required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/categories` | Create with translations |
| `GET` | `/categories` | List for client |
| `GET` | `/categories/:categoryId` | Get single |
| `PATCH` | `/categories/:categoryId` | Update (translations upsert) |
| `DELETE` | `/categories/:categoryId` | Delete |

### Tags (auth required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tags` | Create tag |
| `GET` | `/tags` | List all for client |
| `GET` | `/tags/:tagId` | Get single |
| `GET` | `/tags/:tagId/events` | Events with this tag |
| `PATCH` | `/tags/:tagId` | Update label |
| `DELETE` | `/tags/:tagId` | Delete (cascades from events) |

### Events (auth required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/events` | Create |
| `GET` | `/events` | List with filters |
| `GET` | `/events/:eventId` | Get with children |
| `GET` | `/events/:eventId/stats` | Participant stats |
| `PATCH` | `/events/:eventId` | Update |
| `PUT` | `/events/:eventId/complete` | Mark COMPLETED |
| `POST` | `/events/:eventId/participants` | Add participant |
| `PATCH` | `/events/:eventId/participants/:participantId/status` | Update status |
| `PUT` | `/events/:eventId/participants/:participantId/checkin` | Check in |
| `DELETE` | `/events/:eventId/participants/:participantId` | Cancel participant |

**GET /events filters**: `status`, `type`, `categoryId`, `tagId`, `isOnline`, `fromDate`, `toDate`

---

## Webhook

Client sets `webhookUrl` on their record. `WebhookService.enqueue` writes a `WebhookDelivery` row (outbox); the `processQueue` cron POSTs it, HMAC-signed with the client's webhook secret.

**Currently only `event.published` and `event.cancelled` fire** (`event.controller.ts`). The other types below exist in `WebhookEventType` but nothing emits them yet.

Event types: `event.created`, `event.updated`, `event.cancelled`, `event.published`, `event.completed`, `participant.joined`, `participant.status_changed`, `participant.removed`, `participant.checked_in`.

`webhook.helper.ts` has `formatEventForWebhook(event, locale?)` and `formatParticipantForWebhook(participant, locale?)` — both accept an optional locale, fall back to first available translation.

Webhook failures are caught and logged — they never break the main operation.

---

## Prisma Notes

- Run `pnpm prisma:generate` after any schema change before running the app.
- Run `pnpm prisma:migrate` to create and apply a new migration.
- `RecurrenceRule` is unscoped (no `clientId`) — it's a pure config object.
- `Tag.slug` is auto-lowercased at service level before DB write.
- `EventTag` is an explicit junction model (not implicit many-to-many) — cannot use Prisma's `connect`/`set` shorthand. Use `deleteMany` + `createMany` to replace tags.

---

## Cron Jobs

- `EventService.cleanupPastEvents` — 2AM daily. Child recurring events (`parentEventId != null`) in the past move `DRAFT`/`PUBLISHED` → `COMPLETED`; `COMPLETED`/`CANCELLED` children older than `RETENTION_DAYS` (90) are deleted.
- `EventService.cleanupExpiredIdempotencyKeys` — hourly. Deletes expired `IdempotencyKey` rows.
- `WebhookService.processQueue` — every minute. Delivers `PENDING` `WebhookDelivery` rows whose `nextRetryAt` has passed (retry with backoff).
- `WebhookService.cleanupDeliveries` — weekly. Deletes `DELIVERED` deliveries older than 30 days.

---

## Adding a New Module

1. `src/modules/<name>/dto/<name>.dto.ts` — DTOs with class-validator + `@ApiProperty`
2. `src/modules/<name>/<name>.service.ts` — injectable service, inject `PrismaService`, scope every query by `req.client.id`
3. `src/modules/<name>/<name>.controller.ts` — `@ApiTags`; auth is automatic via the global `BastionJwtGuard` (no `@UseGuards` needed). Under `/admin/*` it is **not** — add `BastionUserGuard`/`BastionSuperAdminGuard` + `AdminThrottlerGuard` yourself (see warning above)
4. `src/modules/<name>/<name>.module.ts` — export service
5. Add to `AppModule` imports

Do NOT add `PrismaService` to module providers — it is globally provided.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Docs

- `../docs/GATHERLY_INTEGRATION.md` — integration guide per altri servizi (unica copia)
- `docs/dev-plans/` — piani di sviluppo storici
- `../docs/BASTION_INTEGRATION.md` — Bastion JWT/JWKS guide
- `../docs/FILEHARBOR_INTEGRATION.md` — FileHarbor integration guide
- `../docs/ARTICUNO_INTEGRATION.md` — Articuno integration guide
- `../docs/CODING_STANDARDS.md` — NestJS conventions condivise
