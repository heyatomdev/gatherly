# Dev Plan — Webhook Retry con Exponential Backoff

## Goal

Webhook attuale è fire-and-forget: se il consumer è down, il payload è perso. Aggiungere retry con exponential backoff e log di delivery persistente.

---

## Approccio scelto: retry in-process con log su DB

Scelta pragmatica senza dipendenze esterne (no Redis, no BullMQ). Adeguato per volume moderato. Se il throughput scala, migrare a BullMQ (vedi nota finale).

---

## Schema Prisma — nuova tabella

```prisma
model WebhookDelivery {
  id          String   @id @default(uuid())
  clientId    String
  client      Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  eventType   String   // "event.created", "participant.joined", ecc.
  payload     Json
  webhookUrl  String
  attempts    Int      @default(0)
  maxAttempts Int      @default(5)
  nextRetryAt DateTime @default(now())
  lastError   String?
  status      WebhookDeliveryStatus @default(PENDING)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([status, nextRetryAt])
  @@index([clientId])
  @@map("webhook_deliveries")
}

enum WebhookDeliveryStatus {
  PENDING
  DELIVERED
  FAILED
}
```

Aggiungere relazione su `Client`:
```prisma
webhookDeliveries WebhookDelivery[]
```

---

## Modifiche richieste

### 1. `src/modules/webhook/webhook.service.ts`

#### Enqueue invece di send diretto

```typescript
async enqueue(
  clientId: string,
  webhookUrl: string,
  payload: EventWebhookPayload | ParticipantWebhookPayload,
): Promise<void> {
  await this.prisma.webhookDelivery.create({
    data: {
      clientId,
      webhookUrl,
      eventType: payload.event,
      payload: payload as any,
    },
  });
}
```

Tutti i `notify*` chiamano `enqueue` invece di `sendWebhookNotification` direttamente.

#### Worker cron — ogni minuto

```typescript
@Cron('* * * * *') // ogni minuto
async processQueue(): Promise<void> {
  const pending = await this.prisma.webhookDelivery.findMany({
    where: {
      status: 'PENDING',
      nextRetryAt: { lte: new Date() },
    },
    take: 50, // batch size
    orderBy: { nextRetryAt: 'asc' },
  });

  await Promise.allSettled(pending.map((d) => this.attempt(d)));
}

private async attempt(delivery: WebhookDelivery): Promise<void> {
  const attempts = delivery.attempts + 1;

  try {
    const body = JSON.stringify(delivery.payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Gatherly/1.0 Webhook',
    };

    // HMAC se secret disponibile (vedi dev-plan 03)
    const client = await this.prisma.client.findUnique({
      where: { id: delivery.clientId },
      select: { webhookSecret: true },
    });
    if (client?.webhookSecret) {
      headers['X-Webhook-Signature'] = this.signPayload(client.webhookSecret, body);
    }

    await firstValueFrom(
      this.httpService.post(delivery.webhookUrl, body, {
        headers,
        timeout: 10_000,
      }),
    );

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'DELIVERED', attempts },
    });
  } catch (error) {
    const backoffSeconds = Math.pow(2, attempts) * 30; // 30s, 60s, 120s, 240s, 480s
    const failed = attempts >= delivery.maxAttempts;

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        status: failed ? 'FAILED' : 'PENDING',
        nextRetryAt: failed ? undefined : new Date(Date.now() + backoffSeconds * 1000),
        lastError: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    if (failed) {
      this.logger.error(
        `Webhook permanently failed after ${attempts} attempts: ${delivery.webhookUrl}`,
      );
    }
  }
}
```

### 2. `src/modules/webhook/webhook.module.ts`

Aggiungere `ScheduleModule` se non già presente (già in uso per `EventService`).

### 3. `src/modules/clients/client.controller.ts`

Aggiungere endpoint per ispezionare le delivery fallite:

```
GET /clients/:id/webhook-deliveries?status=FAILED
```

Utile per debug e replay manuale.

---

## Backoff schedule

| Attempt | Delay |
|---------|-------|
| 1 | 30s |
| 2 | 60s |
| 3 | 120s |
| 4 | 240s |
| 5 | 480s → FAILED |

---

## Cleanup cron

Aggiungere un cron settimanale per eliminare delivery consegnate vecchie di 30 giorni:

```typescript
@Cron(CronExpression.EVERY_WEEK)
async cleanupDeliveries() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await this.prisma.webhookDelivery.deleteMany({
    where: { status: 'DELIVERED', updatedAt: { lt: cutoff } },
  });
}
```

---

## Note — upgrade a BullMQ

Se il volume di webhook scala (>1000/min), sostituire il cron worker con BullMQ + Redis. L'interfaccia `enqueue` rimane la stessa — solo l'implementazione interna cambia.

---

## Checklist

- [ ] Aggiungere modello `WebhookDelivery` + enum allo schema Prisma + migrazione
- [ ] Aggiungere relazione `webhookDeliveries` su `Client`
- [ ] Implementare `enqueue` in `webhook.service.ts`
- [ ] Sostituire tutte le chiamate `sendWebhookNotification` dirette con `enqueue`
- [ ] Implementare `processQueue` cron (ogni minuto)
- [ ] Implementare `attempt` con backoff
- [ ] Implementare `cleanupDeliveries` cron (settimanale)
- [ ] Aggiungere `GET /clients/:id/webhook-deliveries` (opzionale, debug)
- [ ] Iniettare `PrismaService` in `WebhookService` (attualmente non presente)
