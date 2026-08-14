# Dev Plan — POST /events/:id/participants/bulk

## Goal

Aggiungere endpoint per aggiungere più partecipanti in una singola richiesta. Use case principale: import di squadre, liste pre-esistenti, sincronizzazione batch da app chiamante.

---

## Endpoint

```
POST /events/:id/participants/bulk
```

---

## Request body

```json
{
  "participants": [
    { "type": "EXTERNAL", "userName": "Mario", "externalId": "d-001", "externalSource": "discord" },
    { "type": "EXTERNAL", "userName": "Luigi", "externalId": "d-002", "externalSource": "discord" },
    { "type": "INLINE", "userName": "Ospite", "email": "ospite@example.com" }
  ],
  "skipDuplicates": true
}
```

`skipDuplicates: true` — ignora partecipanti già iscritti invece di fallire (default: `false`).

---

## Modifiche richieste

### 1. `src/modules/events/dto/event.dto.ts`

```typescript
export class BulkAddParticipantsDto {
  @ApiProperty({ type: [AddParticipantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100) // limite per request
  @ValidateNested({ each: true })
  @Type(() => AddParticipantDto)
  participants: AddParticipantDto[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  skipDuplicates?: boolean;
}

export class BulkAddParticipantsResultDto {
  added: number;
  waitlisted: number;
  skipped: number; // duplicati ignorati (skipDuplicates=true)
  errors: Array<{ index: number; reason: string }>; // falliti parziali
}
```

### 2. `src/modules/events/event.service.ts`

```typescript
async addParticipantsBulk(
  eventId: string,
  clientId: string,
  data: BulkAddParticipantsDto,
): Promise<BulkAddParticipantsResultDto> {
  return this.prisma.$transaction(
    async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: eventId, clientId },
        include: {
          participants: { where: { status: { in: ['REGISTERED', 'CONFIRMED'] } } },
        },
      });
      if (!event) throw new NotFoundException('Event not found');

      const result: BulkAddParticipantsResultDto = {
        added: 0, waitlisted: 0, skipped: 0, errors: [],
      };

      let activeCount = event.participants.length;

      for (let i = 0; i < data.participants.length; i++) {
        const p = data.participants[i];
        try {
          // Check duplicato per EXTERNAL
          if (p.type === 'EXTERNAL' && p.externalId && p.externalSource) {
            const exists = await tx.participant.findUnique({
              where: {
                eventId_externalId_externalSource: {
                  eventId, externalId: p.externalId, externalSource: p.externalSource,
                },
              },
            });
            if (exists) {
              if (data.skipDuplicates) { result.skipped++; continue; }
              result.errors.push({ index: i, reason: 'Already registered' });
              continue;
            }
          }

          const status: 'REGISTERED' | 'WAITLIST' =
            event.maxParticipants && activeCount >= event.maxParticipants
              ? 'WAITLIST'
              : 'REGISTERED';

          await tx.participant.create({
            data: {
              eventId,
              type: p.type ?? 'INLINE',
              userName: p.userName,
              email: p.email,
              externalId: p.externalId,
              externalSource: p.externalSource,
              status,
              role: p.role ?? 'ATTENDEE',
              notes: p.notes,
              metadata: p.metadata,
            },
          });

          if (status === 'REGISTERED') { result.added++; activeCount++; }
          else { result.waitlisted++; }
        } catch (error: any) {
          if (error.code === 'P2002') {
            if (data.skipDuplicates) { result.skipped++; }
            else { result.errors.push({ index: i, reason: 'Already registered' }); }
          } else {
            result.errors.push({ index: i, reason: error.message ?? 'Unknown error' });
          }
        }
      }

      return result;
    },
    { isolationLevel: 'Serializable' },
  );
}
```

### 3. `src/modules/events/event.controller.ts`

```typescript
@Post(':eventId/participants/bulk')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Add multiple participants in one request. Returns counts of added/waitlisted/skipped/errors.' })
async addParticipantsBulk(
  @Request() req,
  @Param('eventId') eventId: string,
  @Body() dto: BulkAddParticipantsDto,
) {
  return this.eventService.addParticipantsBulk(eventId, req.client.id, dto);
}
```

---

## Response example

```json
{
  "added": 8,
  "waitlisted": 2,
  "skipped": 1,
  "errors": [
    { "index": 4, "reason": "Already registered" }
  ]
}
```

---

## Limiti e considerazioni

- Max 100 partecipanti per request (validato da `@ArrayMaxSize(100)`)
- Transazione `Serializable` — consistente con `addParticipant` singolo
- Fallimenti parziali: con `skipDuplicates: false` gli errori vengono collezionati ma la transazione committa comunque per i validi. Se serve "tutto o niente", cambiare logica per rollback on first error.
- Nessun webhook per il bulk — il consumer conosce già i partecipanti che ha inviato.

---

## Checklist

- [ ] Aggiungere `BulkAddParticipantsDto` e `BulkAddParticipantsResultDto` in `event.dto.ts`
- [ ] Implementare `addParticipantsBulk` in `event.service.ts`
- [ ] Aggiungere `POST /events/:id/participants/bulk` nel controller
- [ ] Testare comportamento waitlist con `maxParticipants` sul bulk
