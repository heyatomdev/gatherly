# Dev Plan — Cancel Endpoint + State Machine

## Goal

Aggiungere `PUT /events/:id/cancel` con logica dedicata e introdurre una state machine che impedisce transizioni di stato invalide su `PATCH /events`.

---

## Transizioni valide

```
DRAFT      → PUBLISHED, CANCELLED
PUBLISHED  → CANCELLED, COMPLETED
CANCELLED  → (nessuna)
COMPLETED  → (nessuna)
```

---

## Modifiche richieste

### 1. `src/modules/events/event.service.ts`

#### State machine helper

```typescript
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT:     ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['CANCELLED', 'COMPLETED'],
  CANCELLED: [],
  COMPLETED: [],
};

private assertTransition(from: string, to: string) {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(
      `Cannot transition event from ${from} to ${to}`,
    );
  }
}
```

#### Guard in `updateEvent`

```typescript
if (scalarData.status) {
  const current = await this.prisma.event.findFirst({
    where: { id: eventId, clientId },
    select: { status: true },
  });
  this.assertTransition(current!.status, scalarData.status);
}
```

#### Metodo `cancelEvent`

```typescript
async cancelEvent(eventId: string, clientId: string) {
  const event = await this.getEventById(eventId, clientId);
  this.assertTransition(event.status, 'CANCELLED');

  const updated = await this.prisma.event.update({
    where: { id: eventId },
    data: { status: 'CANCELLED' },
    include: EVENT_INCLUDE,
  });

  // Cancella tutti i child eventi futuri
  await this.prisma.event.updateMany({
    where: {
      parentEventId: eventId,
      startTime: { gt: new Date() },
      status: { notIn: ['CANCELLED', 'COMPLETED'] },
    },
    data: { status: 'CANCELLED' },
  });

  return updated;
}
```

> Webhook `event.cancelled` va triggerato dal controller (pattern già usato da `completeEvent`).

### 2. `src/modules/events/event.controller.ts`

```typescript
@Put(':eventId/cancel')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Cancel event — blocks further status changes. Cancels future recurring children.' })
async cancelEvent(@Request() req, @Param('eventId') eventId: string) {
  return this.eventService.cancelEvent(eventId, req.client.id);
}
```

---

## Comportamento su eventi ricorrenti

| Scenario | Comportamento |
|----------|---------------|
| Cancella evento padre | Tutti i child futuri → `CANCELLED` |
| Cancella singolo child | Solo quel child → `CANCELLED` |
| Child già `COMPLETED` | Non toccato |

---

## Checklist

- [ ] Aggiungere `VALID_TRANSITIONS` e `assertTransition` in `event.service.ts`
- [ ] Aggiungere guard `assertTransition` in `updateEvent` quando `status` è presente
- [ ] Implementare `cancelEvent` con cascade su child futuri
- [ ] Aggiungere `PUT /events/:id/cancel` nel controller
- [ ] Triggerare webhook `event.cancelled` nel controller
- [ ] Aggiungere `BadRequestException` agli import NestJS del service
