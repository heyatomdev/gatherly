# Dev Plan — Idempotency Keys

## Goal

Un microservizio che chiama `POST /events` o `POST /events/:id/participants` con retry automatici può creare duplicati se la risposta originale è persa (timeout, network drop). `Idempotency-Key` header permette di ritornare la risposta originale senza rieseguire l'operazione.

---

## Scope

Endpoint con effetti collaterali che beneficiano dell'idempotency:

| Endpoint | Priorità |
|----------|----------|
| `POST /events` | Alta |
| `POST /events/:id/participants` | Alta |
| `POST /clients` | Media |

Endpoint `PATCH`, `PUT`, `DELETE` sono già idempotenti per natura.

---

## Schema Prisma — nuova tabella

```prisma
model IdempotencyKey {
  id           String   @id @default(uuid())
  key          String   // valore dall'header
  clientId     String
  path         String   // es. "POST /events"
  responseBody Json
  statusCode   Int
  createdAt    DateTime @default(now())
  expiresAt    DateTime // TTL: now + 24h

  @@unique([key, clientId, path])
  @@index([expiresAt])
  @@map("idempotency_keys")
}
```

TTL di 24h: sufficiente per retry window tipica. Cleanup con cron.

---

## Modifiche richieste

### 1. `src/common/idempotency.interceptor.ts` — nuovo file

```typescript
import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler,
  ConflictException,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey || !req.client) {
      return next.handle();
    }

    const path = `${req.method} ${req.route?.path ?? req.path}`;
    const clientId = req.client.id;

    return from(
      this.prisma.idempotencyKey.findUnique({
        where: { key_clientId_path: { key: idempotencyKey, clientId, path } },
      }),
    ).pipe(
      switchMap((existing) => {
        if (existing) {
          // Risposta già in cache — ritorna senza rieseguire
          const res = context.switchToHttp().getResponse();
          res.status(existing.statusCode);
          return from(Promise.resolve(existing.responseBody));
        }

        return next.handle().pipe(
          tap(async (responseBody) => {
            const res = context.switchToHttp().getResponse();
            await this.prisma.idempotencyKey.create({
              data: {
                key: idempotencyKey,
                clientId,
                path,
                responseBody,
                statusCode: res.statusCode,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              },
            });
          }),
        );
      }),
    );
  }
}
```

### 2. Applicare l'interceptor agli endpoint target

```typescript
// event.controller.ts
import { UseInterceptors } from '@nestjs/common';
import { IdempotencyInterceptor } from '@/common/idempotency.interceptor';

@Post()
@UseInterceptors(IdempotencyInterceptor)
@HttpCode(HttpStatus.CREATED)
async createEvent(@Request() req, @Body() dto: CreateEventDto) { ... }

@Post(':eventId/participants')
@UseInterceptors(IdempotencyInterceptor)
@HttpCode(HttpStatus.CREATED)
async addParticipant(...) { ... }
```

### 3. Cleanup cron in `EventService` o nuovo `MaintenanceService`

```typescript
@Cron(CronExpression.EVERY_HOUR)
async cleanupExpiredIdempotencyKeys() {
  await this.prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
```

---

## Comportamento

```
POST /events
Idempotency-Key: req-abc-123
→ 201 { id: "event-uuid", ... }   ← crea evento, salva response

POST /events (retry, stessa key)
Idempotency-Key: req-abc-123
→ 201 { id: "event-uuid", ... }   ← risposta cached, nessun nuovo evento
```

---

## Documentazione API

Aggiungere `@ApiHeader` a Swagger:

```typescript
@ApiHeader({
  name: 'Idempotency-Key',
  required: false,
  description: 'UUID generato dal caller. Richieste con la stessa key ritornano la risposta originale senza rieseguire.',
})
```

---

## Checklist

- [ ] Aggiungere modello `IdempotencyKey` allo schema Prisma + migrazione
- [ ] Creare `src/common/idempotency.interceptor.ts`
- [ ] Applicare interceptor a `POST /events` e `POST /events/:id/participants`
- [ ] Aggiungere cleanup cron per chiavi scadute
- [ ] Aggiungere `@ApiHeader` per Swagger
- [ ] Iniettare `PrismaService` nell'interceptor (globale, già disponibile)
