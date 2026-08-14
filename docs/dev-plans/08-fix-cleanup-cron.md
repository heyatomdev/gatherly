# Dev Plan — Fix cleanupPastEvents Cron

## Goal

`cleanupPastEvents` elimina solo child ricorrenti già `COMPLETED` o `CANCELLED` nel passato. I child `PUBLISHED` o `DRAFT` passati non vengono mai puliti — accumulo infinito nel DB.

---

## Bug attuale

```typescript
@Cron(CronExpression.EVERY_DAY_AT_2AM)
async cleanupPastEvents() {
  await this.prisma.event.deleteMany({
    where: {
      startTime: { lt: new Date() },
      parentEventId: { not: null },
      status: { in: ['COMPLETED', 'CANCELLED'] }, // ← troppo restrittivo
    },
  });
}
```

Un evento ricorrente `PUBLISHED` del passato non viene mai eliminato.

---

## Fix

### Strategia: due fasi

**Fase 1 — auto-complete** eventi passati `PUBLISHED` prima di eliminarli (mantiene storico sensato):

```typescript
@Cron(CronExpression.EVERY_DAY_AT_2AM)
async cleanupPastEvents() {
  const cutoff = new Date();

  // Fase 1: porta a COMPLETED i child PUBLISHED/DRAFT scaduti
  await this.prisma.event.updateMany({
    where: {
      parentEventId: { not: null },
      startTime: { lt: cutoff },
      status: { in: ['DRAFT', 'PUBLISHED'] },
    },
    data: { status: 'COMPLETED' },
  });

  // Fase 2: elimina child COMPLETED/CANCELLED più vecchi di N giorni
  const retentionCutoff = new Date(cutoff.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  await this.prisma.event.deleteMany({
    where: {
      parentEventId: { not: null },
      startTime: { lt: retentionCutoff },
      status: { in: ['COMPLETED', 'CANCELLED'] },
    },
  });
}
```

### Retention period configurabile

```typescript
// In cima al file o in config
const RETENTION_DAYS = 90; // mantieni storico 90 giorni
```

Esporre come ENV var (`RECURRING_EVENT_RETENTION_DAYS`) se serve configurazione per ambiente.

---

## Comportamento atteso post-fix

| Status child | `startTime` | Azione |
|---|---|---|
| `DRAFT` / `PUBLISHED` | < now | → `COMPLETED` |
| `COMPLETED` / `CANCELLED` | < `retentionCutoff` | Eliminato |
| `COMPLETED` / `CANCELLED` | tra `retentionCutoff` e `now` | Mantenuto (storico) |
| Qualsiasi | > now | Non toccato |

---

## Note

- La fase 1 non triggerà webhook `event.completed` — è una transizione di stato automatica interna, non un'azione utente. Documentare questo comportamento.
- Se serve storico illimitato, fase 2 può essere omessa o `RETENTION_DAYS` impostato a valore molto alto.
- Gli eventi **padre** (non ricorrenti e parent ricorrenti) non vengono mai eliminati dal cron — solo i child.

---

## Checklist

- [ ] Aggiungere fase 1 (auto-complete child scaduti) in `cleanupPastEvents`
- [ ] Aggiungere fase 2 con `RETENTION_DAYS` configurabile
- [ ] Definire `RETENTION_DAYS` come costante o ENV var
- [ ] Aggiornare `config.validation.ts` se si aggiunge ENV var
- [ ] Documentare che auto-complete non triggerà webhook
