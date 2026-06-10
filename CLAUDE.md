# Gatherly — Project Guide

## Purpose

Multi-tenant event management API. Clients (gyms, gaming orgs, etc.) call the API with a token to create and manage events, categories, tags, and participants. Supports i18n (it/en or any locale), recurring events via iCal RRULE, and two participant types: inline (no external account) and external (linked to a third-party user ID).

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

| Var | Default | Required |
|-----|---------|----------|
| `DATABASE_URL` | — | Yes |
| `NODE_ENV` | `development` | No |
| `PORT` | `3000` | No |
| `BASE_URL` | `http://localhost:3000` | No |

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
    client-auth.guard.ts     # reads X-Client-Token header, attaches req.client
  filters/
    http-exception.filter.ts # global error shape
  configs/
    config.schema.ts         # config factory
    config.validation.ts     # Joi schema
  modules/
    prisma/                  # @Global PrismaService
    app/                     # root module, status endpoint
    clients/                 # Client CRUD + token management
    categories/              # EventCategory CRUD (i18n)
    events/                  # Event CRUD + participants + recurrence
    tags/                    # Tag CRUD (client-scoped)
    webhook/                 # WebhookService + helper formatters
```

**PrismaModule** is `@Global()` — never add `PrismaService` to `providers[]` in other modules.

---

## Auth

All routes except `POST /clients` and `GET /clients` require `X-Client-Token` header.

`ClientAuthGuard` checks:
1. Header present
2. Token exists in DB
3. `client.isActive === true` (revoked clients fail)

Token attached to `req.client` — access in controllers via `@Request() req`.

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

### Clients (no auth required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/clients` | Create client — returns token |
| `GET` | `/clients` | List all (token excluded) |
| `PATCH` | `/clients/:id` | Update name/locale/emailActive/webhookUrl |
| `POST` | `/clients/:id/revoke` | Revoke — blocks all API calls |
| `POST` | `/clients/:id/token` | Regenerate token |

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

Client sets `webhookUrl` on their record. `WebhookService` sends POST to that URL on events.

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

`EventService.cleanupPastEvents` — runs at 2AM daily. Deletes child recurring events (`parentEventId != null`) whose `startTime` is in the past.

---

## Adding a New Module

1. `src/modules/<name>/dto/<name>.dto.ts` — DTOs with class-validator decorators
2. `src/modules/<name>/<name>.service.ts` — injectable service, inject `PrismaService`
3. `src/modules/<name>/<name>.controller.ts` — `@ApiTags`, `@UseGuards(ClientAuthGuard)` if auth required
4. `src/modules/<name>/<name>.module.ts` — include `ClientAuthGuard` in providers if used, export service
5. Add to `AppModule` imports

Do NOT add `PrismaService` to module providers — it is globally provided.
