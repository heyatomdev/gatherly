# Dev Plan — PUT /events/:id/publish

## Goal

Aggiungere endpoint dedicato `PUT /events/:id/publish` per la transizione `DRAFT → PUBLISHED`. Attualmente pubblicare un evento richiede `PATCH` con `{ status: "PUBLISHED" }` — senza validazione dei campi obbligatori e senza webhook dedicato.

---

## Endpoint

```
PUT /events/:id/publish
```

Nessun body richiesto.

---

## Logica di validazione pre-publish

Prima di pubblicare, verificare che l'evento abbia il minimo necessario:

| Campo | Regola |
|---|---|
| `translations` | Almeno 1 translation con `title` non vuoto |
| `startTime` | Nel futuro |
| `authorId` | Presente (già obbligatorio in create) |

> Estendere la lista in base ai requisiti di business dei client. Tenere la validazione leggera — meglio falsi positivi che bloccare pubblicazioni valide.

---

## Modifiche richieste

### 1. `src/modules/events/event.service.ts`

```typescript
async publishEvent(eventId: string, clientId: string) {
  const event = await this.prisma.event.findFirst({
    where: { id: eventId, clientId },
    include: { translations: true },
  });
  if (!event) throw new NotFoundException('Event not found');

  // State machine (da dev-plan 02)
  this.assertTransition(event.status, 'PUBLISHED');

  // Validazione pre-publish
  if (!event.translations.length || !event.translations[0].title?.trim()) {
    throw new BadRequestException('Event must have at least one translation with a title');
  }
  if (event.startTime <= new Date()) {
    throw new BadRequestException('Cannot publish an event with a start time in the past');
  }

  return this.prisma.event.update({
    where: { id: eventId },
    data: { status: 'PUBLISHED' },
    include: EVENT_INCLUDE,
  });
}
```

> Dipende dal `assertTransition` del dev-plan 02. Se 02 non è ancora implementato, aggiungere check inline temporaneo.

### 2. `src/modules/events/event.controller.ts`

```typescript
@Put(':eventId/publish')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Publish event — validates required fields, transitions DRAFT → PUBLISHED' })
async publishEvent(@Request() req, @Param('eventId') eventId: string) {
  const event = await this.eventService.publishEvent(eventId, req.client.id);
  // Webhook
  if (req.client.webhookUrl) {
    await this.webhookService.notifyEventPublished(
      req.client.webhookUrl,
      req.client.id,
      event,
    );
  }
  return event;
}
```

---

## Relazione con dev-plan 02

`publishEvent` usa `assertTransition` definito in dev-plan 02 (state machine). I due plan sono indipendenti ma si integrano naturalmente: implementare 02 prima o in parallelo.

---

## Checklist

- [ ] Implementare `publishEvent` in `event.service.ts`
- [ ] Aggiungere `PUT /events/:id/publish` nel controller
- [ ] Triggerare webhook `event.published` nel controller
- [ ] Definire e documentare i requisiti minimi per la pubblicazione
- [ ] Coordinare con dev-plan 02 (state machine) per `assertTransition`
