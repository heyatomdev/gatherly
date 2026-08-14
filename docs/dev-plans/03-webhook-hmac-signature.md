# Dev Plan — Webhook HMAC Signature

## Goal

Aggiungere firma HMAC-SHA256 su ogni webhook outbound. Il consumer verifica `X-Webhook-Signature` per autenticare l'origine del payload.

---

## Schema

```
X-Webhook-Signature: sha256=<hex(HMAC-SHA256(secret, rawBody))>
```

Il `secret` è per-client, generato alla creazione o rigenerato on-demand.

---

## Modifiche richieste

### 1. Schema Prisma — `clients`

```prisma
model Client {
  // ...existing fields...
  webhookSecret String? // nullable: null = firma disabilitata
}
```

Creare migrazione:
```bash
pnpm prisma:migrate
```

### 2. `src/modules/clients/client.service.ts`

Generare `webhookSecret` random alla creazione del client (se `webhookUrl` presente, o sempre):

```typescript
import { randomBytes } from 'crypto';

// In createClient:
webhookSecret: randomBytes(32).toString('hex'),
```

Aggiungere endpoint `POST /clients/:id/webhook-secret` per rigenerare:

```typescript
async regenerateWebhookSecret(clientId: string) {
  return this.prisma.client.update({
    where: { id: clientId },
    data: { webhookSecret: randomBytes(32).toString('hex') },
    select: { id: true, webhookSecret: true },
  });
}
```

> `webhookSecret` NON deve mai apparire in `GET /clients` (list) né in response generiche — solo nell'endpoint dedicato di rigenerazione.

### 3. `src/modules/webhook/webhook.service.ts`

Aggiungere firma al `sendWebhookNotification`:

```typescript
import { createHmac } from 'crypto';

private signPayload(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

private async sendWebhookNotification(
  webhookUrl: string | null | undefined,
  payload: EventWebhookPayload | ParticipantWebhookPayload,
  webhookSecret?: string | null,
): Promise<void> {
  if (!webhookUrl) return;

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Gatherly/1.0 Webhook',
  };

  if (webhookSecret) {
    headers['X-Webhook-Signature'] = this.signPayload(webhookSecret, body);
  }

  try {
    await firstValueFrom(
      this.httpService.post(webhookUrl, body, { headers }),
    );
  } catch (error) {
    this.logger.error(`Webhook failed to ${webhookUrl}: ${error.message}`);
  }
}
```

Aggiornare tutti i metodi pubblici (`notifyEventCreated`, ecc.) per ricevere e passare `webhookSecret`.

### 4. Tutti i call-site del webhook (controller/service)

Passare `req.client.webhookSecret` insieme a `req.client.webhookUrl`.

---

## Verifica lato consumer (documentazione)

```typescript
// Esempio verifica in Node.js
import { createHmac, timingSafeEqual } from 'crypto';

function verifySignature(secret: string, rawBody: string, header: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}
```

> Usare `timingSafeEqual` — confronto stringa normale è vulnerabile a timing attack.

---

## Checklist

- [ ] Aggiungere `webhookSecret String?` allo schema Prisma + migrazione
- [ ] Generare secret in `createClient`
- [ ] Aggiungere `POST /clients/:id/webhook-secret` nel controller clients
- [ ] Nascondere `webhookSecret` da tutte le response list/get client
- [ ] Aggiungere `signPayload` + firma header in `webhook.service.ts`
- [ ] Aggiornare tutti i `notify*` per accettare e passare il secret
- [ ] Documentare verifica lato consumer nel README o in `docs/`
