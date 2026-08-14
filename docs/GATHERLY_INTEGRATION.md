# Gatherly — Integration Guide

> Multi-tenant event management API. Each integrating app is a **Client** with its own token.
> Swagger at `GET /docs` (non-production only).

---

## Authentication

All endpoints except `POST /clients` and `GET /clients` require:

```
X-Client-Token: <your-token>
```

Token is returned on client creation and regeneration. Revoked clients get `401` on every call.

---

## Response envelope

Every response is wrapped:

```json
{ "data": <payload> }
```

Paginated responses (list endpoints) skip the outer wrap and return directly:

```json
{
  "data": [...],
  "meta": { "total": 143, "page": 1, "limit": 20, "totalPages": 8 }
}
```

### Error shape

```json
{
  "statusCode": 400,
  "message": "Cannot transition event from COMPLETED to PUBLISHED",
  "errors": ["Cannot transition event from COMPLETED to PUBLISHED"],
  "timestamp": "2026-07-01T10:00:00.000Z",
  "path": "/events/abc/publish"
}
```

---

## Pagination

All list endpoints accept:

| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `page` | `1` | — | Page number (1-based) |
| `limit` | `20` | `100` | Items per page |

---

## Idempotency

`POST /events` and `POST /events/:id/participants` support idempotency to prevent duplicates on retry:

```
Idempotency-Key: <uuid-generated-by-caller>
```

Same key + same caller + same path → returns the original cached response without re-executing. Keys expire after 24h.

---

## Rate limiting

Default: **100 requests / 60 seconds** per IP. Configurable via `THROTTLE_LIMIT` and `THROTTLE_TTL_MS` env vars. Exceeded: `429 Too Many Requests`.

---

## Clients

### Create client

```
POST /clients
Content-Type: application/json
```

```json
{
  "name": "My Gaming Org",
  "webhookUrl": "https://myapp.example.com/webhooks/gatherly",
  "defaultLocale": "it"
}
```

Response `201`:
```json
{
  "data": {
    "id": "uuid",
    "name": "My Gaming Org",
    "token": "64-char-hex-token",
    "isActive": true,
    "defaultLocale": "it",
    "emailActive": false,
    "webhookUrl": "https://myapp.example.com/webhooks/gatherly",
    "createdAt": "2026-07-01T10:00:00.000Z"
  }
}
```

**Save the token** — it won't appear again in list/get endpoints.

### List clients

```
GET /clients
```

Returns all clients. Token field excluded.

### Update client

```
PATCH /clients/:id
X-Client-Token: <token>
```

```json
{
  "name": "Updated Name",
  "webhookUrl": "https://newurl.example.com/hook",
  "defaultLocale": "en",
  "emailActive": true
}
```

### Revoke client

```
POST /clients/:id/revoke
X-Client-Token: <token>
```

Permanently blocks all API calls for this client.

### Regenerate token

```
POST /clients/:id/token
X-Client-Token: <token>
```

Returns `{ data: { id, name, token } }`. Old token immediately invalid.

### Regenerate webhook secret

```
POST /clients/:id/webhook-secret
X-Client-Token: <token>
```

Returns `{ data: { id, webhookSecret } }`. Use this secret to verify `X-Webhook-Signature` on incoming webhooks.

### List webhook deliveries

```
GET /clients/:id/webhook-deliveries?status=FAILED
X-Client-Token: <token>
```

`status` filter: `PENDING | DELIVERED | FAILED`. Useful for debugging missed webhooks. Last 100 records.

---

## Events

### Create event

```
POST /events
X-Client-Token: <token>
Idempotency-Key: <uuid>  (optional)
```

```json
{
  "translations": [
    { "locale": "it", "title": "Torneo Gaming", "description": "Descrizione torneo" },
    { "locale": "en", "title": "Gaming Tournament" }
  ],
  "defaultLocale": "it",
  "authorId": "user-123",
  "authorName": "Mario Rossi",
  "authorEmail": "mario@example.com",
  "startTime": "2026-08-01T18:00:00Z",
  "endTime": "2026-08-01T21:00:00Z",
  "timezone": "Europe/Rome",
  "status": "DRAFT",
  "type": "gaming",
  "tagSlugs": ["competitive", "5v5"],
  "categoryId": "uuid",
  "isOnline": false,
  "locationName": "Arena Roma",
  "maxParticipants": 16,
  "isPublic": true,
  "price": 10.00,
  "currency": "EUR",
  "recurrenceRule": "FREQ=WEEKLY;BYDAY=SA",
  "recurrenceCount": 8,
  "recurrenceEndDate": "2026-10-01T00:00:00Z"
}
```

`tagSlugs` — slugs are auto-created if they don't exist.
`recurrenceRule` — iCal RRULE string. Generates child events automatically.

### List events

```
GET /events?status=PUBLISHED&tagId=uuid&page=2&limit=10
X-Client-Token: <token>
```

Filters: `status`, `type`, `categoryId`, `tagId`, `isOnline` (`true`/`false`), `fromDate`, `toDate` (ISO 8601).

Returns paginated result.

### Get event

```
GET /events/:eventId
X-Client-Token: <token>
```

Includes `childEvents` (recurring instances), translations, tags, participants, category.

### Get event stats

```
GET /events/:eventId/stats
X-Client-Token: <token>
```

```json
{
  "data": {
    "event": { "..." },
    "stats": {
      "totalParticipants": 14,
      "registered": 10,
      "confirmed": 2,
      "waitlist": 3,
      "cancelled": 1,
      "attended": 0,
      "checkedIn": 0,
      "availableSpots": 4
    }
  }
}
```

### Update event

```
PATCH /events/:eventId
X-Client-Token: <token>
```

All fields optional. Pass `translations` to upsert by locale. Pass `tagSlugs` to replace all tags (`[]` removes all).

Status via PATCH goes through state machine — invalid transitions return `400`.

### Publish event

```
PUT /events/:eventId/publish
X-Client-Token: <token>
```

Transitions `DRAFT → PUBLISHED`. Validates:
- At least one translation with non-empty title
- `startTime` in the future

Triggers webhook `event.published`.

### Complete event

```
PUT /events/:eventId/complete
X-Client-Token: <token>
```

Transitions `PUBLISHED → COMPLETED`.

### Cancel event

```
PUT /events/:eventId/cancel
X-Client-Token: <token>
```

Transitions `DRAFT → CANCELLED` or `PUBLISHED → CANCELLED`. Also cancels all future recurring child events.

Triggers webhook `event.cancelled`.

### State machine

```
DRAFT → PUBLISHED, CANCELLED
PUBLISHED → CANCELLED, COMPLETED
CANCELLED → (terminal)
COMPLETED → (terminal)
```

Invalid transition returns `400 Bad Request`.

---

## Participants

### Add participant

```
POST /events/:eventId/participants
X-Client-Token: <token>
Idempotency-Key: <uuid>  (optional)
```

**INLINE** (no external account):
```json
{
  "type": "INLINE",
  "userName": "Mario Rossi",
  "email": "mario@example.com",
  "role": "ATTENDEE",
  "notes": "Allergia al nichel",
  "metadata": { "team": "Alfa", "seed": 3 }
}
```

**EXTERNAL** (linked to third-party user):
```json
{
  "type": "EXTERNAL",
  "userName": "MarioGamer",
  "externalId": "discord-user-456",
  "externalSource": "discord",
  "role": "ATTENDEE",
  "metadata": { "rank": "Diamond" }
}
```

`role`: `ATTENDEE | SPEAKER | ORGANIZER | HOST`

If `maxParticipants` is reached, participant is automatically added with `status: WAITLIST`.

EXTERNAL participants are unique per `(eventId, externalId, externalSource)`. Duplicate → `409 Conflict`.

### List participants

```
GET /events/:eventId/participants?status=REGISTERED&externalSource=discord&page=1
X-Client-Token: <token>
```

Filters: `status`, `role`, `externalSource`, `externalId`, `checkedIn` (`true`/`false`).

Use `externalId` + `externalSource` to check if a specific user is already registered:
```
GET /events/:id/participants?externalId=discord-user-456&externalSource=discord
```
Empty `data` array → not registered.

### Bulk add participants

```
POST /events/:eventId/participants/bulk
X-Client-Token: <token>
```

```json
{
  "participants": [
    { "type": "EXTERNAL", "userName": "Mario", "externalId": "d-001", "externalSource": "discord" },
    { "type": "EXTERNAL", "userName": "Luigi", "externalId": "d-002", "externalSource": "discord" },
    { "type": "INLINE",   "userName": "Ospite", "email": "ospite@example.com" }
  ],
  "skipDuplicates": true
}
```

Max 100 participants per request. Response `200`:
```json
{
  "data": {
    "added": 8,
    "waitlisted": 2,
    "skipped": 1,
    "errors": [
      { "index": 4, "reason": "Already registered" }
    ]
  }
}
```

`skipDuplicates: true` → silently skips already-registered EXTERNAL participants instead of reporting them as errors. Partial failures are collected in `errors` — valid participants are still added.

### Update participant status

```
PATCH /events/:eventId/participants/:participantId/status
X-Client-Token: <token>
```

```json
{ "status": "CONFIRMED" }
```

`status`: `REGISTERED | WAITLIST | CONFIRMED | CANCELLED | ATTENDED`

If set to `CANCELLED` and `maxParticipants` is set, first waitlisted participant is auto-promoted to `REGISTERED`.

### Check in participant

```
PUT /events/:eventId/participants/:participantId/checkin
X-Client-Token: <token>
```

Sets `checkedIn: true`, `checkedInAt: now`, `status: ATTENDED`.

### Remove participant

```
DELETE /events/:eventId/participants/:participantId
X-Client-Token: <token>
```

Sets status to `CANCELLED`. Auto-promotes first waitlisted participant if event has `maxParticipants`.

---

## Categories

All require `X-Client-Token`.

```
POST   /categories
GET    /categories
GET    /categories/:categoryId
PATCH  /categories/:categoryId
DELETE /categories/:categoryId
```

Create/update accept translations:
```json
{
  "color": "#FF5733",
  "icon": "trophy",
  "translations": [
    { "locale": "it", "name": "Competitivo" },
    { "locale": "en", "name": "Competitive" }
  ]
}
```

---

## Tags

All require `X-Client-Token`.

```
POST   /tags
GET    /tags
GET    /tags/:tagId
GET    /tags/:tagId/events
PATCH  /tags/:tagId
DELETE /tags/:tagId
```

```json
{
  "slug": "5v5",
  "label": { "it": "Cinque contro cinque", "en": "Five vs Five" }
}
```

`slug` is lowercased automatically. Tags are auto-created when referenced in event `tagSlugs`.

---

## Webhooks

Set `webhookUrl` on the client to receive event notifications.

### Payload shape

```json
{
  "event": "participant.joined",
  "timestamp": "2026-07-01T18:05:00.000Z",
  "clientId": "uuid",
  "data": { "..." }
}
```

### Event types

| Type | Trigger |
|------|---------|
| `event.created` | Event created |
| `event.updated` | Event updated via PATCH |
| `event.published` | `PUT /events/:id/publish` |
| `event.cancelled` | `PUT /events/:id/cancel` |
| `event.completed` | `PUT /events/:id/complete` |
| `participant.joined` | Participant added |
| `participant.status_changed` | Participant status updated |
| `participant.removed` | Participant deleted |
| `participant.checked_in` | Participant checked in |

### Signature verification

Every webhook includes `X-Webhook-Signature: sha256=<hex>`.

Verify in Node.js:
```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifySignature(secret: string, rawBody: string, header: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}

// Express example
app.post('/webhooks/gatherly', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-webhook-signature'] as string;
  if (!verifySignature(process.env.GATHERLY_WEBHOOK_SECRET, req.body.toString(), sig)) {
    return res.status(401).send('Invalid signature');
  }
  const payload = JSON.parse(req.body.toString());
  // handle payload.event ...
  res.sendStatus(200);
});
```

Get/rotate the secret:
```
POST /clients/:id/webhook-secret
X-Client-Token: <token>
```

### Retry policy

Failed deliveries are retried with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | 30s |
| 2 | 60s |
| 3 | 120s |
| 4 | 240s |
| 5 | 480s → marked FAILED |

Your endpoint must respond `2xx` within 10 seconds. Delivered records are purged after 30 days.

---

## Health

```
GET /health
```

No auth required. Returns `200` with service status.

---

## Common error codes

| Code | Meaning |
|------|---------|
| `400` | Validation failed or invalid state transition |
| `401` | Missing or invalid `X-Client-Token` |
| `403` | Client revoked |
| `404` | Resource not found |
| `409` | Duplicate EXTERNAL participant |
| `429` | Rate limit exceeded |
