# Dev Plan — GET /events/:id/participants

## Goal

Aggiungere endpoint per listare i partecipanti di un evento con filtri e paginazione. Attualmente l'unico accesso ai partecipanti è tramite `/stats` (aggregato) o caricandoli embedded nell'evento.

---

## Endpoint

```
GET /events/:eventId/participants
```

Query params:
- `page`, `limit` — da `PageParams`
- `status` — `REGISTERED | WAITLIST | CONFIRMED | CANCELLED | ATTENDED`
- `role` — `ATTENDEE | SPEAKER | ORGANIZER | HOST`
- `externalSource` — es. `"discord"`, `"steam"`
- `checkedIn` — `boolean`
- `externalId` — cerca partecipante per ID esterno (con `externalSource`)

---

## Modifiche richieste

### 1. `src/modules/events/dto/event.dto.ts`

```typescript
import { PageParams } from '@/common/pagination';

export class GetParticipantsQueryDto extends PageParams {
  @ApiPropertyOptional({ enum: ['REGISTERED', 'WAITLIST', 'CONFIRMED', 'CANCELLED', 'ATTENDED'] })
  @IsOptional()
  @IsEnum(['REGISTERED', 'WAITLIST', 'CONFIRMED', 'CANCELLED', 'ATTENDED'])
  status?: string;

  @ApiPropertyOptional({ enum: ['ATTENDEE', 'SPEAKER', 'ORGANIZER', 'HOST'] })
  @IsOptional()
  @IsEnum(['ATTENDEE', 'SPEAKER', 'ORGANIZER', 'HOST'])
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : undefined)
  @IsBoolean()
  checkedIn?: boolean;
}
```

### 2. `src/modules/events/event.service.ts`

```typescript
import { PaginatedResult, paginate } from '@/common/pagination';

async getParticipants(
  eventId: string,
  clientId: string,
  query: GetParticipantsQueryDto,
): Promise<PaginatedResult<Participant>> {
  const event = await this.prisma.event.findFirst({
    where: { id: eventId, clientId },
    select: { id: true },
  });
  if (!event) throw new NotFoundException('Event not found');

  const where: Prisma.ParticipantWhereInput = {
    eventId,
    ...(query.status && { status: query.status as any }),
    ...(query.role && { role: query.role as any }),
    ...(query.externalSource && { externalSource: query.externalSource }),
    ...(query.externalId && { externalId: query.externalId }),
    ...(query.checkedIn !== undefined && { checkedIn: query.checkedIn }),
  };

  const [data, total] = await this.prisma.$transaction([
    this.prisma.participant.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: query.skip,
      take: query.limit,
    }),
    this.prisma.participant.count({ where }),
  ]);

  return paginate(data, total, query);
}
```

### 3. `src/modules/events/event.controller.ts`

```typescript
@Get(':eventId/participants')
@ApiOperation({ summary: 'List participants for an event with filters and pagination' })
async getParticipants(
  @Request() req,
  @Param('eventId') eventId: string,
  @Query() query: GetParticipantsQueryDto,
) {
  return this.eventService.getParticipants(eventId, req.client.id, query);
}
```

---

## Response shape

```json
{
  "data": [
    {
      "id": "uuid",
      "type": "EXTERNAL",
      "userName": "MarioGamer",
      "externalId": "discord-user-456",
      "externalSource": "discord",
      "status": "REGISTERED",
      "role": "ATTENDEE",
      "checkedIn": false,
      "metadata": { "rank": "Diamond" },
      "createdAt": "2026-07-01T10:00:00Z"
    }
  ],
  "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
}
```

---

## Use case principale

App chiamante conosce `externalId` e `externalSource` del proprio utente:

```
GET /events/:id/participants?externalId=discord-user-456&externalSource=discord
```

Ritorna il partecipante specifico (o array vuoto se non iscritto) — utile per check "è già iscritto?" senza tenere stato lato consumer.

---

## Checklist

- [ ] Aggiungere `GetParticipantsQueryDto` in `event.dto.ts`
- [ ] Implementare `getParticipants` in `event.service.ts`
- [ ] Aggiungere `GET /events/:id/participants` nel controller
- [ ] Aggiungere import `Prisma` per `ParticipantWhereInput`
