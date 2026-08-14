# Dev Plan — Recurrence: N creates → createMany

## Goal

`generateRecurringInstances` usa `Promise.all` con N `prisma.event.create` singoli. Per 52 occorrenze sono 52 round-trip al DB. Ottimizzare con batch insert.

---

## Problema attuale

```typescript
await Promise.all(
  occurrences.map((occurrence) =>
    this.prisma.event.create({ data: { ... } }), // N query
  ),
);
```

Prisma non supporta `createMany` con relazioni nested (`translations`, `tags`). Soluzione: separare la creazione degli eventi da quella delle relations.

---

## Fix

### `src/modules/events/event.service.ts`

```typescript
private async generateRecurringInstances(parentEvent: any) {
  const rule = parentEvent.recurrenceRule;
  if (!rule) return;

  // ... (calcolo occurrences invariato, vedi dev-plan 05 per timezone) ...

  const futureOccurrences = occurrences.filter((o) => o > new Date());
  if (!futureOccurrences.length) return;

  const duration = parentEvent.endTime
    ? parentEvent.endTime.getTime() - parentEvent.startTime.getTime()
    : null;

  await this.prisma.$transaction(async (tx) => {
    // Step 1: crea tutti gli eventi in batch
    // createMany non ritorna gli id su tutti i provider — usare transaction + create sequenziale
    // oppure: genera uuid lato app per avere gli id prima dell'insert

    const { randomUUID } = await import('crypto');

    const eventIds = futureOccurrences.map(() => randomUUID());

    await tx.event.createMany({
      data: futureOccurrences.map((occurrence, i) => ({
        id: eventIds[i],
        clientId: parentEvent.clientId,
        defaultLocale: parentEvent.defaultLocale,
        authorId: parentEvent.authorId,
        authorName: parentEvent.authorName,
        authorEmail: parentEvent.authorEmail,
        startTime: occurrence,
        endTime: duration ? new Date(occurrence.getTime() + duration) : undefined,
        timezone: parentEvent.timezone,
        status: parentEvent.status,
        type: parentEvent.type,
        coverImageUrl: parentEvent.coverImageUrl,
        categoryId: parentEvent.categoryId,
        locationName: parentEvent.locationName,
        locationAddress: parentEvent.locationAddress,
        locationUrl: parentEvent.locationUrl,
        isOnline: parentEvent.isOnline,
        maxParticipants: parentEvent.maxParticipants,
        isPublic: parentEvent.isPublic,
        price: parentEvent.price,
        currency: parentEvent.currency,
        parentEventId: parentEvent.id,
        recurrenceRuleId: parentEvent.recurrenceRuleId,
      })),
    });

    // Step 2: crea translations in batch
    const translationData = eventIds.flatMap((eventId) =>
      parentEvent.translations.map((t: any) => ({
        eventId,
        locale: t.locale,
        title: t.title,
        description: t.description ?? null,
      })),
    );

    if (translationData.length) {
      await tx.eventTranslation.createMany({ data: translationData });
    }

    // Step 3: crea tags in batch
    const tagData = eventIds.flatMap((eventId) =>
      parentEvent.tags.map((et: any) => ({ eventId, tagId: et.tagId })),
    );

    if (tagData.length) {
      await tx.eventTag.createMany({ data: tagData });
    }
  });
}
```

---

## Perché generare UUID lato app

`createMany` in Prisma non ritorna gli `id` generati (limitazione del provider). Generare gli UUID in Node.js con `crypto.randomUUID()` (nativo da Node 15+, zero dipendenze) permette di avere gli id prima dell'insert e usarli per le relazioni.

Il formato è compatibile con `@id @default(uuid())` di Prisma — Prisma usa UUIDv4, `crypto.randomUUID()` produce UUIDv4.

---

## Impatto performance (stima)

| Scenario | Prima | Dopo |
|---|---|---|
| 52 occorrenze, 2 traduzioni, 3 tag | ~57 query | 3 query (createMany × 3) |
| 10 occorrenze, 1 traduzione | ~11 query | 3 query |

---

## Dipendenze

- Dev-plan 05 (timezone fix) modifica la stessa funzione. Coordinare: applicare entrambi i fix insieme o in sequenza, non in parallelo.

---

## Checklist

- [ ] Refactor `generateRecurringInstances` con `createMany` a 3 step
- [ ] Generare UUID lato app con `crypto.randomUUID()`
- [ ] Avvolgere in `$transaction` per atomicità
- [ ] Coordinare con dev-plan 05 (stesso metodo)
- [ ] Verificare che `recurrenceRuleId` sia propagato ai child (fix collaterale)
