# Dev Plan — Fix Timezone in Recurrence Generation

## Goal

`generateRecurringInstances` usa `rrulestr` con `dtstart: parentEvent.startTime` (UTC da Postgres) senza considerare il campo `timezone` dell'evento. Risultato: per timezone non-UTC le occorrenze vengono generate all'orario sbagliato (es. un evento alle 18:00 Europe/Rome diventa 18:00 UTC = 19:00/20:00 locale).

---

## Problema attuale

```typescript
// startTime da Postgres è sempre UTC
const rrule = rrulestr(rule.rule, { dtstart: parentEvent.startTime });
```

`rrule` interpreta `dtstart` come floating time — non converte il timezone.

---

## Fix

### Dipendenza richiesta

```bash
pnpm add luxon
pnpm add -D @types/luxon
```

Oppure usare `date-fns-tz` se già nel progetto.

### `src/modules/events/event.service.ts`

```typescript
import { DateTime } from 'luxon';

private async generateRecurringInstances(parentEvent: any) {
  const rule = parentEvent.recurrenceRule;
  if (!rule) return;

  const tz = parentEvent.timezone ?? 'UTC';

  // Converti startTime UTC → datetime nel timezone dell'evento
  const dtstart = DateTime.fromJSDate(parentEvent.startTime, { zone: 'utc' })
    .setZone(tz)
    .toJSDate();

  const rrule = rrulestr(rule.rule, {
    dtstart,
    tzid: tz,
  });

  const maxOccurrences = rule.count ?? 52;
  const endDate = rule.endDate;

  let occurrences = rrule
    .all((_, count) => count < maxOccurrences)
    .filter((d) => d.getTime() !== parentEvent.startTime.getTime());

  if (endDate) occurrences = occurrences.filter((d) => d <= endDate);

  const duration = parentEvent.endTime
    ? parentEvent.endTime.getTime() - parentEvent.startTime.getTime()
    : null;

  const now = new Date();
  const futureOccurrences = occurrences.filter((o) => o > now);

  if (!futureOccurrences.length) return;

  // createMany al posto di N create — vedi dev-plan 13
  await this.prisma.$transaction(
    futureOccurrences.map((occurrence) =>
      this.prisma.event.create({
        data: {
          clientId: parentEvent.clientId,
          defaultLocale: parentEvent.defaultLocale,
          authorId: parentEvent.authorId,
          authorName: parentEvent.authorName,
          authorEmail: parentEvent.authorEmail,
          startTime: occurrence,
          endTime: duration ? new Date(occurrence.getTime() + duration) : undefined,
          timezone: tz,
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
          translations: {
            create: parentEvent.translations.map((t: any) => ({
              locale: t.locale,
              title: t.title,
              description: t.description,
            })),
          },
          tags: {
            create: parentEvent.tags.map((et: any) => ({ tagId: et.tagId })),
          },
        },
      }),
    ),
  );
}
```

> `recurrenceRuleId` aggiunto sui child — attualmente mancante, utile per risalire alla rule da un child.

### Propagare errore al caller

Rimuovere il `try/catch` silenzioso — lanciare l'errore così `createEvent` fallisce atomicamente:

```typescript
// PRIMA
} catch (error) {
  console.error('Errore nella generazione ricorrenze:', error);
}

// DOPO — nessun try/catch qui, gestito dalla transaction in createEvent
```

---

## Note sul formato RRULE con timezone

La spec iCal supporta `TZID` nel DTSTART (`DTSTART;TZID=Europe/Rome:20260701T180000`). Se il campo `rule` nel DB include già DTSTART con TZID, la logica sopra è ridondante — verificare il formato salvato e normalizzare in input se necessario.

---

## Checklist

- [ ] Installare `luxon` (o alternativa già presente)
- [ ] Refactor `generateRecurringInstances` con conversione timezone via `luxon`
- [ ] Aggiungere `recurrenceRuleId` ai child events
- [ ] Rimuovere `try/catch` silenzioso — propagare errore
- [ ] Verificare formato RRULE salvato in DB — se include `DTSTART;TZID=` già, adattare di conseguenza
