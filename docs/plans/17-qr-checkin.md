---
type: plan
service: gatherly
status: open
estimate: 2.5d
updated: 2026-10-22
verified: 472cfe3
---

# 17 · Check-in da QR / codice partecipante (GX2)

## Perché

Alla porta di una lezione o di uno stage chi accoglie ha un telefono, non un portatile. Oggi il
check-in in Meridian è una ricerca per nome in una lista (`CheckInMode`): lenta con una coda,
ambigua con omonimi, e mostra le email di tutti gli iscritti a chiunque guardi lo schermo.
Serve un codice per partecipante, mostrabile come QR, che la console legge dalla fotocamera.

## Stato attuale

- `prisma/schema.prisma:184` — `Participant`: `id` (UUID), `checkedIn`, `checkedInAt`. Nessun
  codice. L'UUID non va usato come codice: è la chiave di ogni route admin e finisce nei webhook.
- `src/modules/events/event.service.ts:884` — `checkInParticipant()`: lock sull'evento
  (`lockEvent` `:155`), `ATTENDED` → ritorna la riga senza webhook (già idempotente),
  `WAITLIST`/`CANCELLED` → 409 (`CHECKIN_STATUSES` `:38`). ⚠️ **Non controlla lo stato
  dell'evento**: `lockEvent` legge `status` ma nessuno lo guarda, quindi oggi si fa check-in su
  un evento `CANCELLED` o `COMPLETED` (Meridian nasconde solo i bottoni).
- `src/modules/admin/controllers/admin-participants.controller.ts:80` —
  `PUT /admin/events/:eventId/participants/:participantId/checkin`.
- `src/modules/webhook/webhook.helper.ts:62` — payload partecipante in whitelist (niente email):
  un campo nuovo non ci finisce da solo.
- Consegna al partecipante: **nessuna**. `Client.emailActive` (`schema.prisma:28`) esiste ma
  nessun codice lo legge; Gatherly non chiama Herald. sgweb
  (`sgweb/server/api/events/[id]/participants.post.ts:1-4`) risponde solo `{ status }`.
- Meridian: `app/components/gatherly/CheckInMode.vue` (overlay a schermo intero, ricerca per
  nome/email, `fetchAllParticipants`), aperto da `events/[id]/index.vue:33` e `:321`; route BFF
  `server/api/[tenant]/gatherly/events/[id]/participants/[pid]/checkin.put.ts`.

## Cosa

### Lato servizio (Gatherly)

1. **Codice partecipante** — `Participant.checkinCode String? @unique`: 12 caratteri esadecimali
   maiuscoli da `crypto.randomBytes(6)` (48 bit), mostrati a gruppi `A1B2-C3D4-E5F6`. Esadecimale
   e non base32: niente O/I/L ambigue, niente alfabeto custom. Unico globale (non per evento), così
   un codice di un altro evento si riconosce come tale invece di sembrare inesistente.
   Generato in `addParticipant` (`:660`) e `addParticipantsBulk` (`:706`); collisione (`P2002`
   sul campo) → un nuovo tentativo, poi errore. Migration: colonna nullable + backfill SQL delle
   righe esistenti con `upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))`
   (`gen_random_uuid` è nel core da PG 13, CSPRNG), poi indice unico.
   48 bit bastano: il codice non apre nulla da solo, serve un admin autenticato che lo scansioni,
   e il throttler admin limita i tentativi.
2. **Esposizione del codice**: nella risposta di `POST /events/:id/participants` (+ bulk) e di
   `GET .../participants` sia service-client sia admin. **Non** nel webhook (whitelist invariata):
   chi lo vuole lo legge dalla risposta o dalla riga.
3. **Check-in per codice** — `POST /admin/events/:eventId/checkin { code }`, nuovo metodo
   `checkInByCode(eventId, clientId, code)`: normalizza (maiuscolo, via spazi e `-`), cerca per
   `checkinCode` **dentro il client**, poi delega a `checkInParticipant`. Risposta
   `{ data: { participant, alreadyCheckedIn } }` — `alreadyCheckedIn` viene dal `changed` che
   `checkInParticipant` calcola già (va solo restituito). Stesso endpoint su `/events` per i
   service-client: rimandato, nessun consumer.
4. **Stato evento**: `checkInParticipant` rifiuta con `409 EVENT_CLOSED` un evento `CANCELLED` o
   `COMPLETED` (vale anche per il `PUT` esistente). Un `DRAFT` non può avere partecipanti.
   **Fatto il 2026-10-22** (solo `PUT .../checkin` esistente; il nuovo `POST .../checkin` lo erediterà da `checkInParticipant`).
5. Test in `event.service.spec.ts` accanto a `describe('checkInParticipant')` (`:1084`).

### Lato Meridian

1. **Pagina** `app/pages/[tenant]/gatherly/events/[id]/checkin.vue` con URL proprio (un telefono
   alla porta ricarica, va in standby, si apre dai preferiti), `layout: 'blank'` — da aggiungere
   alle eccezioni di `meridian/CLAUDE.md` ("Pagine di autenticazione"). Il bottone del masthead
   diventa un `NuxtLink`; `CheckInMode.vue` diventa il corpo della pagina (non si tiene in doppio).
2. **Scanner**: `BarcodeDetector` nativo (`formats: ['qr_code']`) su `getUserMedia({ video:
   { facingMode: 'environment' } })`, un frame ogni ~250 ms, stop al primo codice e ripresa dopo
   l'esito. Senza `BarcodeDetector` (Safari iOS, Firefox) o senza permesso camera: niente
   fotocamera, resta il **campo codice** (`inputmode="text"`, `autocapitalize="characters"`) e la
   ricerca per nome esistente come terzo ripiego.
3. **Esito a tutto schermo**, leggibile a un metro: verde "Entrato · <nome>", ambra "Già entrato
   alle 19:02" (`alreadyCheckedIn`), rosso per `404` codice sconosciuto, `409` lista d'attesa /
   annullato / evento chiuso / codice di un altro evento. Vibrazione (`navigator.vibrate`) dove
   c'è. Mostra il **nome**, mai l'email.
4. **Rete debole**: timeout 8 s, poi "Riprova" sullo stesso codice — sicuro perché il check-in è
   idempotente. Niente coda offline in v1 (vedi domande).
5. **Show partecipante / riga**: il codice in `.mono` e un QR da mostrare o stampare per chi non
   ha la mail. Generare il QR richiede una libreria (vedi domande); in v1 basta il codice testuale.
6. BFF `server/api/[tenant]/gatherly/events/[id]/checkin.post.ts`: whitelist `{ code }`
   (stringa, max 20), `gatherlyAdmin(POST /events/:id/checkin)`.

### Consegna al partecipante

- **v1 — app client**: sgweb, dopo l'iscrizione, mostra il codice (e il QR) nella conferma.
  È un cambio di sgweb (rompe "never echoes participant data" solo per il codice, non per i dati
  personali): un commit separato in quel repo, dopo il deploy di Gatherly.
- **Mail di conferma via Herald** (`Client.emailActive`, oggi morto): fuori da questo piano.
  Richiede un client Herald in Gatherly, template i18n e la decisione su chi spedisce
  (Gatherly o l'app client). Piano a parte se serve.

## Contratto API

```
POST /admin/events/:eventId/checkin        { "code": "A1B2-C3D4-E5F6" }
200 { "data": { "participant": { ...riga, "checkinCode": "A1B2C3D4E5F6" }, "alreadyCheckedIn": false } }
400 VALIDATION_FAILED   code mancante o non esadecimale dopo la normalizzazione
404 PARTICIPANT_NOT_FOUND   nessun codice nel client
409 WRONG_EVENT         il codice esiste nel client ma per un altro evento (nessun dettaglio dell'altro evento)
409 EVENT_CLOSED        evento CANCELLED/COMPLETED (anche su PUT .../checkin)
409                     partecipante WAITLIST/CANCELLED (esistente)
```

Riga partecipante: campo nuovo `checkinCode` (sempre presente dopo il backfill). Da aggiornare
`docs/integrations/gatherly.md` (sezioni participant e check in) e `gatherly/CLAUDE.md`.

## Sicurezza / permessi

- Il codice è un identificatore, non una credenziale: il check-in resta dietro `BastionUserGuard`
  (admin) e `gatherly-events.manage` in Meridian (già coperto da
  `['*', '/gatherly/events/**', 'gatherly-events.manage']`, pagina compresa).
- Niente email né chiave persona (`p_<hash>`) in URL, QR o log: il QR contiene **solo** il
  codice. Scartato un QR con URL Meridian (si aprirebbe con la fotocamera di sistema anche su iOS,
  ma mette origin e tenant della console in mano a ogni iscritto e il codice nei log nginx).
- `WRONG_EVENT` non dice quale evento: niente enumerazione cross-evento.
- Throttle: `AdminThrottlerGuard` sul controller; verificare che una coda di 1 scansione/2 s per
  un'ora non lo superi.
- Fotocamera: richiede contesto sicuro (HTTPS) e permesso dell'utente; la pagina chiede il
  permesso solo al tap su "Scansiona", non al caricamento.

## Ordine di deploy

1. Gatherly (migration + backfill, `checkinCode` nelle risposte, `POST .../checkin`, `EVENT_CLOSED`).
2. Meridian (pagina check-in, BFF). Contro un Gatherly vecchio il `POST` è 404: la ricerca per
   nome continua a funzionare.
3. sgweb (codice nella conferma d'iscrizione).

## Rischi / domande aperte

1. **iOS alla porta**: Safari non ha `BarcodeDetector`. Se il telefono di chi accoglie è un
   iPhone, la fotocamera non va e resta il codice a mano. Aggiungere il polyfill
   `barcode-detector` (zxing-wasm, caricato solo se manca il nativo)? È una dipendenza nuova:
   decidere sapendo che telefono si usa.
2. **Consegna del codice**: basta la conferma a schermo di sgweb (chi chiude la pagina lo perde)
   o serve la mail di conferma via Herald fin da subito? Senza mail, il v1 copre solo chi fa uno
   screenshot.
3. **Check-in su `COMPLETED`**: un admin che a evento chiuso vuole segnare un presente dimenticato
   prende `EVENT_CLOSED`. Va bene (il record è chiuso) o serve un'eccezione solo admin?

## Criteri di completamento

- [ ] Migration: ogni partecipante esistente ha un `checkinCode` unico di 12 hex; i nuovi (singolo
      e bulk) lo ricevono alla creazione.
- [ ] `POST /admin/events/:id/checkin` con codice valido → `ATTENDED`, webhook
      `participant.checked_in` una volta; secondo invio → 200 `alreadyCheckedIn: true`, nessun
      secondo webhook.
- [ ] Codice di un altro evento → 409 `WRONG_EVENT`; codice di un altro client → 404; codice con
      minuscole/trattini/spazi → normalizzato e accettato.
- [ ] Evento `CANCELLED`/`COMPLETED` → 409 `EVENT_CLOSED`, anche sul `PUT .../checkin` esistente.
- [ ] Webhook partecipante senza `checkinCode` (test sul helper).
- [ ] Unit test in `event.service.spec.ts` per i casi sopra; `pnpm test` verde.
- [ ] Meridian su Chrome Android: `/…/events/<id>/checkin` scansiona un QR col codice ed esegue il
      check-in; su Safari iOS il campo codice funziona senza fotocamera.
- [ ] Nessuna email a schermo nella vista check-in; nessun codice né email nell'URL.
- [ ] Rete tolta a metà → "Riprova" sullo stesso codice dà "Entrato" o "Già entrato", mai doppio.
