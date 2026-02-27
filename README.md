# EventPlan - Multi-tenant Event Management System

Sistema di gestione eventi multi-tenant con NestJS e Prisma che consente a diversi client di creare e gestire eventi in modo isolato.

## Caratteristiche

- **Multi-tenant**: Ogni client ha accesso solo ai propri eventi tramite token
- **Gestione Partecipanti**: Aggiungi e rimuovi partecipanti agli eventi
- **Eventi Ricorrenti**: Crea eventi che si ripetono settimanalmente/mensilmente/annualmente
- **RRULE Support**: Utilizza lo standard RFC 5545 per le ricorrenze
- **Auto Cleanup**: Pulizia automatica degli eventi passati

## Setup

### 1. Installa dipendenze

```bash
npm install
```

### 2. Configura il database

```bash
cp .env.example .env
# Modifica .env con i tuoi dati di connessione PostgreSQL
```

### 3. Esegui le migrazioni

```bash
npm run prisma:migrate
npm run prisma:generate
```

### 4. Avvia l'applicazione

```bash
npm run start:dev
```

L'app sarà disponibile su `http://localhost:3000`

## API Endpoints

### Clients

#### Crea un nuovo client
```bash
POST /clients
Content-Type: application/json

{
  "name": "My Event Company"
}
```

Risposta:
```json
{
  "id": "cluxxxxxx",
  "name": "My Event Company",
  "token": "Y2x1exxxxxx"
}
```

#### Ottieni tutti i client
```bash
GET /clients
```

---

### Events

Tutti gli endpoint degli eventi richiedono l'header: `x-client-token: <token>`

#### Crea un evento
```bash
POST /events
Headers: x-client-token: <token>
Content-Type: application/json

{
  "title": "Weekly Team Meeting",
  "description": "Discussione settimanale",
  "authorId": "user123",
  "authorName": "John Doe",
  "startTime": "2026-03-05T14:00:00Z",
  "recurrenceRule": "FREQ=WEEKLY;BYDAY=WE;INTERVAL=1"
}
```

Risposta:
```json
{
  "id": "cluxxxxxx",
  "title": "Weekly Team Meeting",
  "description": "Discussione settimanale",
  "clientId": "cluxxxxxx",
  "authorId": "user123",
  "authorName": "John Doe",
  "startTime": "2026-03-05T14:00:00Z",
  "isRecurring": true,
  "recurrenceRule": "FREQ=WEEKLY;BYDAY=WE;INTERVAL=1",
  "participants": [],
  "createdAt": "2026-02-26T10:00:00Z",
  "updatedAt": "2026-02-26T10:00:00Z"
}
```

#### Ottieni tutti gli eventi del client
```bash
GET /events
Headers: x-client-token: <token>
```

#### Ottieni un evento specifico
```bash
GET /events/:eventId
Headers: x-client-token: <token>
```

#### Aggiungi un partecipante
```bash
POST /events/:eventId/participants
Headers: x-client-token: <token>
Content-Type: application/json

{
  "userId": "user456",
  "userName": "Jane Smith"
}
```

#### Rimuovi un partecipante
```bash
DELETE /events/:eventId/participants/:userId
Headers: x-client-token: <token>
```

## Esempi di RRULE

### Ogni settimana (lunedì)
```
FREQ=WEEKLY;BYDAY=MO
```

### Ogni due settimane (lunedì e giovedì)
```
FREQ=WEEKLY;BYDAY=MO,TH;INTERVAL=2
```

### Ogni mese (primo giorno)
```
FREQ=MONTHLY;BYMONTHDAY=1
```

### Ogni giorno feriale
```
FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR
```

## Architettura

### Schema del Database

```
Client (1) ---< (M) Event
Event (1) ---< (M) Participant
Event (Parent) ---< (Child) Event (per ricorrenze)
```

### Flusso di Autenticazione

1. Client invia `x-client-token` nell'header
2. `ClientAuthGuard` verifica il token
3. Request viene arricchita con `req.client` contenente i dati del client
4. Tutti i servizi filtrano i dati per `clientId`

### Gestione Ricorrenze

1. Quando crei un evento ricorrente, viene creato l'evento genitore
2. Automaticamente vengono generate 52 istanze (1 anno) dell'evento
3. Ogni istanza ha `parentEventId` che punta all'evento genitore
4. Un cron job giornaliero (ore 2:00) elimina le istanze scadute

## Sviluppo

### Comandi utili

```bash
# Avvia in modalità development con watch
npm run start:dev

# Build per production
npm run build

# Esegui migrazioni Prisma
npm run prisma:migrate

# Genera Prisma Client
npm run prisma:generate
```

### Struttura dei file

```
src/
├── app.module.ts          # Modulo principale
├── index.ts              # Entry point
├── clients/              # Modulo client
│   ├── client.module.ts
│   ├── client.controller.ts
│   └── client.service.ts
├── events/               # Modulo events
│   ├── event.module.ts
│   ├── event.controller.ts
│   ├── event.service.ts
│   └── dto/
│       └── event.dto.ts
├── guards/               # Guards
│   └── client-auth.guard.ts
└── prisma/               # Servizi Prisma
    └── prisma.service.ts
```

## Troubleshooting

### Errore: "Prisma Client not generated"
```bash
npm run prisma:generate
```

### Errore: "Database connection failed"
Verifica che:
- PostgreSQL sia in esecuzione
- L'URL di connessione in `.env` sia corretta
- I permessi del database siano corretti

### Errore: "Token non valido"
Assicurati di:
- Aver creato un client con `POST /clients`
- Usare il token corretto nell'header `x-client-token`

## License

MIT

