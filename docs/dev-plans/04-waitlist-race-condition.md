# Dev Plan — Fix Waitlist Race Condition

## Goal

`promoteFromWaitlist` è chiamata fuori da transazione in `removeParticipant` e `updateParticipantStatus`. Due richieste concorrenti di cancellazione possono promuovere due persone dalla waitlist per un solo posto libero.

---

## Problema attuale

```typescript
// removeParticipant — fuori da $transaction
await this.prisma.participant.update({ where: { id: participantId }, data: { status: 'CANCELLED' } });
if (event.maxParticipants) {
  await this.promoteFromWaitlist(eventId); // ← race: due thread qui contemporaneamente
}
```

---

## Fix

### `src/modules/events/event.service.ts`

#### `removeParticipant` — tutto in transaction

```typescript
async removeParticipant(eventId: string, clientId: string, participantId: string) {
  await this.prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: eventId, clientId },
      select: { id: true, maxParticipants: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    const participant = await tx.participant.findFirst({
      where: { id: participantId, eventId },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    await tx.participant.update({
      where: { id: participantId },
      data: { status: 'CANCELLED' },
    });

    if (event.maxParticipants) {
      await this.promoteFromWaitlistTx(tx, eventId, event.maxParticipants);
    }
  }, { isolationLevel: 'Serializable' });
}
```

#### `updateParticipantStatus` — promozione in transaction

```typescript
async updateParticipantStatus(participantId, eventId, clientId, status) {
  const event = await this.prisma.event.findFirst({
    where: { id: eventId, clientId },
    select: { id: true, maxParticipants: true },
  });
  if (!event) throw new NotFoundException('Event not found');

  return this.prisma.$transaction(async (tx) => {
    const participant = await tx.participant.findFirst({
      where: { id: participantId, eventId },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    const result = await tx.participant.update({
      where: { id: participantId },
      data: { status },
    });

    if (status === 'CANCELLED' && event.maxParticipants) {
      await this.promoteFromWaitlistTx(tx, eventId, event.maxParticipants);
    }

    return result;
  }, { isolationLevel: 'Serializable' });
}
```

#### `promoteFromWaitlistTx` — accetta tx client

```typescript
private async promoteFromWaitlistTx(
  tx: Prisma.TransactionClient,
  eventId: string,
  maxParticipants: number,
) {
  // Conta slot occupati dentro la stessa tx per evitare doppia promozione
  const active = await tx.participant.count({
    where: { eventId, status: { in: ['REGISTERED', 'CONFIRMED'] } },
  });

  if (active >= maxParticipants) return;

  const first = await tx.participant.findFirst({
    where: { eventId, status: 'WAITLIST' },
    orderBy: { createdAt: 'asc' },
  });

  if (first) {
    await tx.participant.update({
      where: { id: first.id },
      data: { status: 'REGISTERED' },
    });
  }
}
```

#### Rimuovere il vecchio `promoteFromWaitlist`

Il metodo privato originale (`promoteFromWaitlist` senza `tx`) può essere rimosso.

---

## Perché `Serializable`

`Serializable` previene phantom read: due transazioni che leggono `count(active)` contemporaneamente vedranno lo stesso valore e solo una potrà committare. L'altra riproverà automaticamente (Postgres serialization failure → retry a livello applicativo se necessario).

> `addParticipant` usa già `Serializable` — pattern consistente.

---

## Checklist

- [ ] Refactor `removeParticipant` dentro `$transaction` con `isolationLevel: Serializable`
- [ ] Refactor `updateParticipantStatus` — promozione dentro `$transaction`
- [ ] Aggiungere `promoteFromWaitlistTx(tx, eventId, maxParticipants)`
- [ ] Rimuovere il vecchio `promoteFromWaitlist`
- [ ] Aggiungere import `Prisma` da `@prisma/client` per il tipo `TransactionClient`
