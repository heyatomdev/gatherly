# Dev Plan — Pagination for GET /events

## Goal

Add offset-based pagination to `GET /events` using the existing `common/pagination.ts` helper.
Currently returns all events for a client in a single query — unbounded, memory-unsafe at scale.

---

## Helper già disponibile

`src/common/pagination.ts` espone:

- `PageParams` — DTO con `page` (default 1) e `limit` (default 20, max 100), getter `skip`
- `PaginatedResult<T>` — shape `{ data, meta: { total, page, limit, totalPages } }`
- `paginate(data, total, params)` — factory function

---

## Modifiche richieste

### 1. `src/modules/events/dto/event.dto.ts`

Aggiungere `GetEventsQueryDto` che estende `PageParams` e include i filtri esistenti:

```typescript
import { PageParams } from '@/common/pagination';

export class GetEventsQueryDto extends PageParams {
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] })
  @IsOptional()
  @IsEnum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tagId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : undefined)
  isOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  toDate?: string;
}
```

### 2. `src/modules/events/event.service.ts`

Modificare `getEventsByClient` per accettare `PageParams` e restituire `PaginatedResult`:

```typescript
import { PageParams, PaginatedResult, paginate } from '@/common/pagination';

async getEventsByClient(
  clientId: string,
  filters: GetEventsQueryDto,
): Promise<PaginatedResult<Event>> {
  const where = {
    clientId,
    ...(filters.status && { status: filters.status }),
    ...(filters.type && { type: filters.type }),
    ...(filters.categoryId && { categoryId: filters.categoryId }),
    ...(filters.tagId && { tags: { some: { tagId: filters.tagId } } }),
    ...(filters.isOnline !== undefined && { isOnline: filters.isOnline }),
    ...(filters.fromDate && { startTime: { gte: new Date(filters.fromDate) } }),
    ...(filters.toDate && { startTime: { lte: new Date(filters.toDate) } }),
  };

  const [data, total] = await this.prisma.$transaction([
    this.prisma.event.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: { startTime: 'asc' },
      skip: filters.skip,
      take: filters.limit,
    }),
    this.prisma.event.count({ where }),
  ]);

  return paginate(data, total, filters);
}
```

> `$transaction` per count + findMany garantisce consistenza sul totale.

### 3. `src/modules/events/event.controller.ts`

Sostituire i singoli `@Query()` con `@Query() query: GetEventsQueryDto`:

```typescript
@Get()
async getEvents(@Request() req, @Query() query: GetEventsQueryDto) {
  return this.eventService.getEventsByClient(req.client.id, query);
}
```

Rimuovere la conversione manuale `isOnline === 'true'` dal controller — ora è nel DTO con `@Transform`.

---

## Response shape dopo la modifica

```json
{
  "data": [ ...events ],
  "meta": {
    "total": 143,
    "page": 2,
    "limit": 20,
    "totalPages": 8
  }
}
```

---

## Breaking change

**Sì** — la response cambia da `Event[]` a `{ data: Event[], meta: {...} }`.
Tutte le app che consumano `GET /events` devono aggiornare il parsing.

---

## Checklist

- [ ] Aggiungere `GetEventsQueryDto` in `event.dto.ts`
- [ ] Aggiornare `getEventsByClient` signature + logica in `event.service.ts`
- [ ] Aggiornare `getEvents` controller — usare `@Query() query: GetEventsQueryDto`
- [ ] Rimuovere conversione `isOnline` inline dal controller
- [ ] Verificare che `ValidationPipe` globale abbia `transform: true` (richiesto da `@Type` di `PageParams`)
- [ ] Aggiornare Swagger — response schema
- [ ] Comunicare breaking change ai consumer
