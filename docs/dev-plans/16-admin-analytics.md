# Dev Plan — Admin Analytics API (stats, people, retention)

## Goal

Aggiungere alla superficie `/admin/*` le API aggregate che oggi mancano e che la console Meridian non può costruire client-side (o non in modo efficiente):

1. **`/admin/stats`** — KPI + trend a livello tenant (dashboard)
2. **`/admin/people`** — directory persone cross-evento (fidelizzazione)
3. **`/admin/analytics/retention`** — coorti di ritorno

Più minori: **usage counts** categorie/tag, **retry** webhook, **settings admin** (config Client del tenant).

Tutto scoped su `req.adminClient.id`, guardato da `BastionUserGuard` + `AdminThrottlerGuard` (riuso plan 15). Aggregazioni pesanti in raw SQL Prisma (`$queryRaw`).

---

## Contesto (schema reale)

- `Event`: `clientId`, `status` (DRAFT|PUBLISHED|CANCELLED|COMPLETED), `startTime`, `maxParticipants?`, `categoryId?`
- `Participant`: `eventId`, `type` (INLINE|EXTERNAL), `userName`, `email?`, `externalId?`, `externalSource?`, `status` (REGISTERED|WAITLIST|CONFIRMED|CANCELLED|ATTENDED), `checkedIn`, `checkedInAt?`, `createdAt`
- `EventService.getEventStats` già calcola le stats **per-evento** — questo plan aggrega a livello **tenant**.

### Identità persona (chiave di dedup cross-evento)

```
personKey =
  externalId  → `ext:{externalSource}:{externalId}`
  else email  → `email:{lower(trim(email))}`
  else        → anonimo (INLINE senza email) → escluso dalle aggregazioni people
```

> INLINE senza email non è deduplicabile. Documentare: la retention/people copre solo persone identificabili (email o external).

---

## Modulo

Nuovo sotto-modulo in `src/modules/admin/`:

```
src/modules/admin/
  analytics/
    admin-analytics.controller.ts   # /admin/stats, /admin/analytics/*
    admin-analytics.service.ts      # aggregazioni ($queryRaw)
    dto/analytics-query.dto.ts
  people/
    admin-people.controller.ts      # /admin/people, /admin/people/:key
    admin-people.service.ts
    dto/people-query.dto.ts
```

Registrare i controller in `AdminModule` (import `PrismaModule` è @Global).

---

## 1. `/admin/stats` — dashboard tenant

### Endpoint

```
GET /admin/stats?from=&to=            → KPI + alerts
GET /admin/stats/timeseries?metric=events|participants&interval=month&from=&to=
GET /admin/stats/breakdown?by=category|tag|status
```

### Response `/admin/stats`

```jsonc
{
  "events": { "draft": 3, "published": 12, "cancelled": 1, "completed": 40, "upcoming": 5 },
  "participants": { "total": 820, "active": 610, "checkedIn": 540 },
  "rates": { "avgFillRate": 0.72, "checkInRate": 0.66, "noShowRate": 0.11 },
  "alerts": {
    "soldOutWithWaitlist": 2,   // maxParticipants raggiunto + WAITLIST > 0
    "staleDrafts": 4,           // DRAFT più vecchi di 30gg
    "pastNotCompleted": 3       // startTime < now, status=PUBLISHED
  }
}
```

### Service (sketch)

```typescript
async tenantStats(clientId: string, from?: Date, to?: Date) {
  const eventWhere = { clientId, ...(from || to ? { startTime: { gte: from, lte: to } } : {}) };

  const byStatus = await this.prisma.event.groupBy({
    by: ['status'], where: eventWhere, _count: true,
  });
  // upcoming, participant aggregates, rates via $queryRaw (fill-rate = confirmed/maxParticipants)
  // noShowRate = 1 - checkedIn / (CONFIRMED+ATTENDED)  su eventi COMPLETED
  // alerts: 3 count query mirate
}
```

> `avgFillRate` e `noShowRate` richiedono join participants↔events → `$queryRaw` (Postgres) più efficiente di caricare tutto in memoria.

### Timeseries (sketch SQL)

```sql
SELECT date_trunc('month', e."startTime") AS bucket, COUNT(*)::int AS value
FROM events e
WHERE e."clientId" = $1 AND e."startTime" BETWEEN $2 AND $3
GROUP BY bucket ORDER BY bucket;
```

Per `participants`: join su `participants` con `date_trunc('month', p."createdAt")`.

---

## 2. `/admin/people` — directory persone cross-evento ⭐

### Endpoint

```
GET /admin/people?search=&segment=&minEvents=&page=&limit=   → lista aggregata
GET /admin/people/:key                                        → profilo (storico)
```

`:key` = personKey URL-encoded (es. `email:mario%40x.com`).

### Response lista (per persona)

```jsonc
{
  "data": [{
    "key": "email:mario@x.com",
    "displayName": "Mario Rossi",         // ultimo userName visto
    "email": "mario@x.com",
    "external": null,                     // { source, id } se EXTERNAL
    "eventsCount": 7,
    "firstSeen": "2025-11-02T...",
    "lastSeen": "2026-07-18T...",
    "checkedInCount": 6,
    "noShowCount": 1,                     // CONFIRMED/REGISTERED ma !checkedIn su eventi passati
    "segment": "returning"               // new | returning | vip | at_risk
  }],
  "meta": { "total": 240, "page": 1, "limit": 20, "totalPages": 12 }
}
```

### Segmenti

- `new`: 1 evento
- `returning`: ≥2 eventi
- `vip`: ≥ `VIP_THRESHOLD` (env, default 5)
- `at_risk`: nessuna partecipazione da > `AT_RISK_DAYS` (env, default 120) ma storico ≥2

### Aggregazione (sketch SQL)

```sql
WITH people AS (
  SELECT
    CASE
      WHEN p."externalId" IS NOT NULL
        THEN 'ext:' || COALESCE(p."externalSource",'') || ':' || p."externalId"
      WHEN p.email IS NOT NULL
        THEN 'email:' || lower(trim(p.email))
    END AS key,
    p."userName", p.email, p."externalId", p."externalSource",
    p.status, p."checkedIn", p."createdAt", e."startTime"
  FROM participants p
  JOIN events e ON e.id = p."eventId"
  WHERE e."clientId" = $1
    AND (p."externalId" IS NOT NULL OR p.email IS NOT NULL)   -- esclude anonimi
)
SELECT key,
       (array_agg("userName" ORDER BY "startTime" DESC))[1] AS display_name,
       max(email) AS email,
       count(DISTINCT "startTime") AS events_count,
       min("startTime") AS first_seen,
       max("startTime") AS last_seen,
       count(*) FILTER (WHERE "checkedIn") AS checked_in_count
FROM people
GROUP BY key
ORDER BY events_count DESC
LIMIT $2 OFFSET $3;
```

> Serve `count(*) OVER()` o una query `count(DISTINCT key)` separata per il totale paginazione.
> `search` → filtro su `userName`/`email` (ILIKE). `minEvents`/`segment` → `HAVING`.

### Profilo `/admin/people/:key`

Decodifica key → ricostruisce il predicato (`externalId+source` **oppure** `lower(email)`), ritorna:
- header persona (come sopra)
- **storico eventi**: lista `{ eventId, title, startTime, status(partecipante), checkedIn }`
- categorie/tag preferiti (top per frequenza)

### Indici richiesti (migration)

```prisma
// già presenti: @@index([externalId]), @@index([eventId]), @@index([status])
// aggiungere:
@@index([email])
// e su Event: @@index([clientId, startTime])
```

---

## 3. `/admin/analytics/retention` — coorti

### Endpoint

```
GET /admin/analytics/retention?granularity=month&months=12
```

### Response (matrice coorti)

```jsonc
{
  "granularity": "month",
  "cohorts": [
    { "cohort": "2026-01", "size": 40, "retention": [1.0, 0.42, 0.30, 0.25] },
    { "cohort": "2026-02", "size": 55, "retention": [1.0, 0.38, 0.28] }
  ]
}
```

`retention[i]` = frazione della coorte che ha partecipato nel mese `cohort + i`.

### Approccio (sketch)

1. Per ogni `personKey`, calcolare **first-seen month** = coorte.
2. Per ogni coorte e offset mese, contare persone distinte della coorte con almeno una partecipazione in `cohort_month + offset`.
3. `retention = attivi_offset / size_coorte`.

Raw SQL con CTE (people identity come sopra) → `date_trunc('month')` su first-seen e su ogni partecipazione → matrice. Cap a `months` per limitare il payload.

> Costo: O(partecipazioni). Con gli indici + `clientId` filtrato è gestibile. Se cresce, materializzare in una view o cron.

---

## 4. Minori

### 4a. Usage counts categorie/tag

```
GET /admin/categories?withUsage=true   → aggiunge eventCount per categoria
GET /admin/tags?withUsage=true         → eventCount + orphan flag (0 eventi)
```
`groupBy` su `Event.categoryId` / join `EventTag`. Estende i controller admin esistenti (plan 15).

### 4b. Webhook retry

```
POST /admin/webhooks/deliveries/:id/retry
```
⚠️ *Verificare prima*: esiste già un retry in `WebhookService`? (plan 07 `07-webhook-retry.md`). Se sì → esporre; se no → fuori scope, solo GET deliveries.

### 4c. Settings admin (config Client del tenant)

La superficie `/admin/*` (plan 15) non espone la gestione del `Client`. La console ha bisogno di leggere/modificare la config del tenant. Aggiungere un `AdminSettingsController` che opera su `req.adminClient` (mai su id arbitrari):

```
GET   /admin/settings                    → { name, defaultLocale, emailActive, webhookUrl, webhookConfigured: bool }
PATCH /admin/settings                    → aggiorna defaultLocale | emailActive | webhookUrl
POST  /admin/settings/webhook-secret     → rigenera secret (ritorna il nuovo UNA VOLTA)
```

Riusa `ClientService.updateClient` / `regenerateWebhookSecret` passando **`req.adminClient.id`** (non un id da URL). `webhookSecret` **mai** ritornato dalle GET (già escluso da `CLIENT_SELECT_SAFE`) — solo dalla risposta di rigenerazione.

File:
```
src/modules/admin/settings/
  admin-settings.controller.ts   # /admin/settings, guard BastionUserGuard + AdminThrottlerGuard
```
DTO: `UpdateSettingsDto` (subset di UpdateClientDto: defaultLocale, emailActive, webhookUrl — **senza** tenantId, che l'admin non deve toccare).

---

## Sicurezza & scoping

- Tutte le route `@UseGuards(BastionUserGuard, AdminThrottlerGuard)` → `req.adminClient.id`
- **Ogni** query filtra `clientId` (anche i raw SQL: `WHERE e."clientId" = $1`) — mai aggregare cross-tenant
- `personKey` in output non espone dati di altri tenant (query già scoped)

---

## Performance

- Aggregazioni via `$queryRaw` parametrizzato (mai string-interpolation → SQL injection)
- Indici: `participants(email)`, `events(clientId, startTime)` — vedi migration
- Cache opzionale (breve TTL) su `/admin/stats` se il dashboard polla spesso
- Se people/retention diventano lenti su tenant grossi → materialized view o snapshot cron notturno

---

## Checklist

**Setup**
- [ ] `src/modules/admin/analytics/` + `people/` (controller + service + dto)
- [ ] Registrare i controller in `AdminModule`
- [ ] Migration: indici `participants(email)`, `events(clientId, startTime)`
- [ ] Helper `personKey` (coalescing external/email) condiviso

**Stats**
- [ ] `GET /admin/stats` (KPI + rates + alerts)
- [ ] `GET /admin/stats/timeseries` (events|participants, month)
- [ ] `GET /admin/stats/breakdown` (category|tag|status)

**People**
- [ ] `GET /admin/people` (aggregate, filtri segment/search/minEvents, paginazione)
- [ ] `GET /admin/people/:key` (profilo + storico + top categorie/tag)
- [ ] Segmenti (new/returning/vip/at_risk) via env `VIP_THRESHOLD`, `AT_RISK_DAYS`

**Retention**
- [ ] `GET /admin/analytics/retention` (matrice coorti, cap `months`)

**Minori**
- [ ] `withUsage` su categories/tags admin
- [ ] `POST /admin/webhooks/deliveries/:id/retry` (solo se WebhookService lo supporta)

**Settings admin (§4c)**
- [ ] `src/modules/admin/settings/admin-settings.controller.ts`
- [ ] `GET /admin/settings` (config del tenant, secret escluso)
- [ ] `PATCH /admin/settings` (`UpdateSettingsDto` senza tenantId) via `updateClient(req.adminClient.id, …)`
- [ ] `POST /admin/settings/webhook-secret` (regen, ritorna una volta)
- [ ] Scoping: opera solo su `req.adminClient`, mai id arbitrario

**Qualità**
- [ ] Raw SQL parametrizzato (no interpolation)
- [ ] Test: scoping cross-tenant (persona di tenant A non appare in tenant B), dedup email case-insensitive, anonimi esclusi
- [ ] Swagger `@ApiBearerAuth()` + tag `admin/analytics`, `admin/people`
- [ ] `graphify update .`
```
