# Gatherly — Backlog

Generato il 2026-10-14 da una review multi-agente (lenti: prodotto/dominio,
integrazione cross-service, API/ops/DX) + una controvalutazione critica che ha
verificato ogni claim sul codice. Riferimenti `file:line` validi a quella data
(commit `8091ba9`).

Verdetti: **DO NOW** · **NEXT** · **LATER** · **ON DEMAND** (solo se un tenant
lo chiede) · **REJECT**.

---

## 1. Bug verificati — da sistemare prima delle feature

| # | Bug | Dove | Stato |
|---|-----|------|-------|
| B1 | Check-in senza guard di stato né lock: `WAITLIST`/`CANCELLED` → `ATTENDED`. `ATTENDED` non è in `ACTIVE_STATUSES`, quindi chi fa check-in libera il posto → overbooking a evento in corso. Stesso buco in `updateParticipantStatus` `WAITLIST → ATTENDED` (salta il check capacità) | `event.service.ts:27`, `622-627`, `649-663` | in corso (`fix-capacity-registration`) |
| B2 | `PATCH /events/:id` accetta `status`: salta validazione di publish, cascade di cancel, audit e webhook corretto (emette `event.updated`) | `event.service.ts:342-379`, `UpdateEventDto` | in corso (`fix-capacity-registration`) |
| B3 | Iscrizioni accettate su eventi `DRAFT`/`CANCELLED`/`COMPLETED`/passati — `addParticipant` controlla solo la capienza | `event.service.ts:483-575` | in corso (`fix-capacity-registration`) |
| B4 | Alzare `maxParticipants` non promuove dalla waitlist | `updateEvent` | in corso (`fix-capacity-registration`) |
| B5 | Idempotency: nessun hash del body (chiave riusata con payload diverso → risposta vecchia); crash dopo claim → 409 per 24h | `src/common/idempotency.interceptor.ts:38-66` | fix in `5851f9d` (`fix/webhook-delivery-idempotency`) |
| B6 | Delivery webhook in coda e retry manuali vanno al `webhookUrl` salvato all'enqueue, anche dopo che il tenant l'ha cambiato | `webhook.service.ts:80,96,152-163,191` | fix in `5851f9d` |
| B7 | Webhook senza delivery id né timestamp di invio nella firma → niente dedupe, replay infinito | `webhook.service.ts:33-35,92,193` | fix in `5851f9d` |
| B8 | People: `events_count` include `CANCELLED`/`WAITLIST`; `last_seen` include eventi futuri → VIP/at-risk falsati | `admin-people.service.ts:~87-101` | aperto |
| B9 | Serie ricorrenti si fermano in silenzio dopo 52 occorrenze / 2 anni; nessun cron le estende | `event.service.ts:67,215-289` | aperto |
| B10 | Toggle "Email notifications" in Meridian non fa nulla (`Client.emailActive` non è letto da nessuno) | `meridian/app/pages/[tenant]/gatherly/settings.vue:59-69` | aperto |
| B11 | Docs obsolete: `X-Client-Token` / `POST /clients` pubblico; colonna `Client.token` e route di regen inutilizzate | `../docs/integrations/gatherly.md`, root `CLAUDE.md:248` | aperto |
| B12 | `updateEvent` non blocca la riga né rivalida un nuovo `startTime` (passato / dopo `endTime`) | `event.service.ts:342-379` | aperto |

Audit: il cambio di `webhookUrl` e la rigenerazione del secret lato tenant
(`admin-settings.controller.ts:53-62`) non sono auditati — incluso in `5851f9d`.

---

## 2. Backlog ordinato

| # | Item | Effort | Verdetto | Note |
|---|------|--------|----------|------|
| 1 | Bug B1–B4 + test di integrazione su Postgres reale (capienza concorrente, check-in, isolamento cross-tenant, idempotency, "ogni controller `/admin` ha un guard") | M | DO NOW | Oggi gli e2e coprono solo admin auth con Prisma mockato |
| 2 | Webhook Standard (`webhook-id`, `webhook-timestamp`, `webhook-signature`) + URL risolto all'invio (B6, B7) | S | DO NOW | Vecchio header mantenuto per una release |
| 3 | Idempotency hardening (B5) + copertura bulk add | S | DO NOW | |
| 4 | Fix conteggi People (B8), poi soglie VIP/at-risk per tenant (`Client.vipThreshold`, `atRiskDays`) | S | DO NOW / NEXT | Una soglia globale non va bene per palestra e meetup mensile |
| 5 | Pulizia B10 + B11 (nascondere toggle, aggiornare docs, drop `Client.token`) | S | DO NOW | |
| 6 | Cron di top-up delle serie (`RecurrenceRule.generatedUntil`) — B9 | S–M | NEXT | Minimo indispensabile della gestione serie |
| 7 | `registrationOpensAt` / `registrationClosesAt` nello stesso guard di B3 | S | NEXT | Cutoff di cancellazione e late-cancel solo su richiesta |
| 8 | Audit residuo (update evento, cambio stato partecipante, check-in, bulk, retry manuale) + metriche cron last-success e tentativi webhook | S | NEXT | |
| 9 | GDPR admin-only: export e anonimizzazione persona (riga mantenuta, PII nullata) + scrub dei payload in `WebhookDelivery` | M | NEXT | Oggi la PII resta per sempre; niente API machine né cron di retention finché non serve |
| 10 | Picker FileHarbor in `EventForm` (solo Meridian, proxy già esistente) · export CSV partecipanti (admin) · duplicazione evento | S | NEXT | |
| 11 | Ordinamento stabile (`id` come tiebreaker), `updatedSince`, filtri `isPublic` e `q` su `GET /events`, paginazione di tags/categories | S–M | NEXT | Cursor pagination solo on demand |
| 12 | Webhook test ping (`POST /webhooks/test`) | S | NEXT | |
| 13 | `waitlistPosition` calcolata in lettura | S | NEXT | Senza nuovi stati |

---

## 3. Later

- **Email transazionali via Herald** (conferma, promozione da waitlist,
  cancellazione) + promemoria T-24h/T-1h + stato mail in Meridian.
  **Bloccante architetturale**: Herald ricava il tenant dal JWT, quindi
  Gatherly deve o salvare credenziali Bastion per tenant o ottenere un grant
  "delegated tenant" da Bastion. Decisione cross-service (Bastion + Herald +
  Gatherly), idealmente un helper "token-for-tenant" in
  `@heyatom/bastion-client`. Va presa prima di qualunque feature che chiami
  Herald/Beacon per conto di un tenant.
- **Gestione completa serie**: `PATCH ?scope=this|following|series`,
  occorrenze staccate, modifica RRULE. Effort L, rischio DST e figli con
  iscritti.
- **Superficie pubblica unica**: feed `GET /public/:slug/events`, iCal per
  feed/evento con token firmato. Progettare una volta sola (rate limit, cache,
  enumerazione slug, mai partecipanti né `authorEmail`).
- Promemoria come webhook `event.starting_soon` (i tenant possono già
  schedularli da `event.published`).
- API machine per le delivery (lista, replay bulk con rate cap).
- Rate limit per tenant con storage condiviso — quando ci sarà più di una
  replica (oggi throttler globale per IP, in-memory, registrato prima del
  guard JWT: `app.module.ts:91-92`).
- OpenAPI come prodotto: response DTO, spec in CI. SDK e versioning URI
  prematuri.

## 4. On demand (solo se un tenant lo chiede)

- Iscrizione a tutta la serie (dipende dalla gestione serie)
- Team / iscrizioni multi-posto (`Participant.seats`: tocca ogni conteggio)
- Domande di iscrizione tipizzate (schema su `metadata`)
- Waitlist offer-and-confirm (richiede nuovo stato)
- Annuncio Discord su publish (`discordWebhookUrl` per client)
- Sottoscrizione webhook per tipo di evento (`Client.webhookEvents`)
- Operazioni bulk sugli eventi, cursor pagination

## 5. Rejected

| Idea | Motivo |
|------|--------|
| Stato `NO_SHOW` + blocco prenotazioni | `no_show_count` esiste già in People; policy di blocco appartiene all'app del tenant; nuovo enum costoso |
| Stato pagamento sui partecipanti | `metadata` basta; i pagamenti sono del sistema del tenant |
| Link eventi ↔ Beacon / `event.live_started` | Nicchia, consumer SSE su ogni replica, accoppiamento |
| Articolo Articuno da evento | Basso valore, sync bidirezionale che deriva |
| Newsletter digest via Herald | Dipende dalle email, scope marketing |
| Self-registration utenti finali (`/me`) | Nuova superficie pubblica L; `externalSource: "bastion"` basta come convenzione documentata |
| GraphQL, più endpoint webhook per tenant, co-host per evento, feedback post-evento | Gold-plating / appartiene al tenant |

---

## Vincolo trasversale

**Evitare nuovi valori di `ParticipantStatus`.** Ognuno si propaga su
`ACTIVE_STATUSES` (`event.service.ts:27`), sui letterali di stato in
`admin-analytics.service.ts` (7), sulle query di `admin-people.service.ts`,
sui DTO dei webhook e su Meridian.
