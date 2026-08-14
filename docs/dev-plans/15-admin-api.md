# Dev Plan — Admin API (`/admin/*`) via Bastion user-JWT

## Goal

Esporre una superficie `/admin/*` per la console Meridian, autenticata con **Bastion user-JWT** (non `X-Client-Token`, non service-client), scoped sul Client del tenant dell'utente loggato, esente dal throttle per-app.

**Principio**: zero nuovo modello utenti. Riusa i `*.service.ts` esistenti — tutti già prendono `clientId`. Gli admin controller sono thin wrapper che passano `req.adminClient.id`.

---

## Contesto già disponibile

- `src/modules/bastion/bastion-jwks.service.ts` — fetch + cache chiave pubblica, `verify(token)` → `JwtPayload`
- `src/modules/bastion/bastion.types.ts` — `JwtPayload` ha già `sub`, `tenantId`, `role`, `permissions`, `type`, `appSlug`
- `src/modules/bastion/guards/bastion-jwt.guard.ts` — pattern esistente: verify JWKS → `client.findUnique({ where: { tenantId } })` → `req.client`
- `EventService`, `CategoryService`, `TagService`, `ClientService` — metodi già `(…, clientId)` scoped
- `src/common/pagination.ts` — `PaginatedResult<T>` shape `{ data, meta }`

**Nota response shape**: gli endpoint list restituiscono `{ data, meta }` (già così). La console Meridian si adatta a questa shape — non reshaping lato gatherly.

---

## Modello auth admin

```
Browser → Meridian BFF → gatherly /admin/*
          Authorization: Bearer <bastion user-JWT>   (inoltrato dal BFF)

gatherly BastionUserGuard:
  1. verify firma via BastionJwksService
  2. payload.type === 'user'            (non 'service_client')
  3. payload.appSlug === 'gatherly'     (utente ha accesso all'app)
  4. role check (ADMIN | OWNER)         (configurabile)
  5. client = findUnique({ tenantId })  → req.adminClient
```

Un admin = un Client (il tenant incarnato nell'identità). Nessuna query cross-client: riusa lo scoping esistente.

---

## Modifiche richieste

### 1. `src/modules/bastion/guards/bastion-user.guard.ts` (nuovo)

```typescript
import { CanActivate, ExecutionContext, Injectable, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BastionJwksService } from '../bastion-jwks.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

const ADMIN_ROLES = ['ADMIN', 'OWNER'];

@Injectable()
export class BastionUserGuard implements CanActivate {
  constructor(
    private readonly jwks: BastionJwksService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Token mancante');

    const payload = await this.jwks.verify(auth.slice(7));

    if (payload.type !== 'user') throw new UnauthorizedException('Non è un token utente');
    if (payload.appSlug !== 'gatherly') throw new ForbiddenException('App non autorizzata');
    if (!ADMIN_ROLES.includes(payload.role ?? '')) throw new ForbiddenException('Ruolo insufficiente');

    const client = await this.prisma.client.findUnique({ where: { tenantId: payload.tenantId } });
    if (!client || !client.isActive) throw new ForbiddenException('Client non attivo per il tenant');

    req.adminUser = payload;       // { sub, email, role, ... }
    req.adminClient = client;      // scoping source
    return true;
  }
}
```

> Esporta il guard dal `BastionModule` (`exports: [BastionUserGuard]`).

### 2. Throttle per-utente sugli admin route

Gatherly ha `ThrottlerGuard` globale (100/60s per-IP). Dietro il BFF Meridian tutti gli admin collassano su un IP → stesso flood di Bastion.

**Fix**: `getTracker` per-utente sugli admin route. Custom guard:

```typescript
// src/guards/admin-throttler.guard.ts
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AdminThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // BastionUserGuard gira prima e popola req.adminUser
    if (req.adminUser?.sub) return `user:${req.adminUser.sub}`;
    return `ip:${req.ip}`;
  }
}
```

Applica `@UseGuards(BastionUserGuard, AdminThrottlerGuard)` sui controller admin (ordine: user prima, così `req.adminUser` è popolato quando il tracker legge). In alternativa `@SkipThrottle()` sugli admin controller se ti fidi del BFF first-party — ma per-utente è più sicuro.

### 3. Admin controllers (nuovi, thin) — riusano i service

Struttura `src/modules/admin/`:

```
src/modules/admin/
  admin.module.ts
  controllers/
    admin-events.controller.ts
    admin-participants.controller.ts
    admin-categories.controller.ts
    admin-tags.controller.ts
    admin-webhooks.controller.ts
```

Esempio — `admin-events.controller.ts`:

```typescript
@ApiTags('admin/events')
@Controller('admin/events')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminEventsController {
  constructor(private events: EventService) {}

  @Get()
  list(@Request() req, @Query() query: GetEventsQueryDto) {
    return this.events.getEventsByClient(req.adminClient.id, query);
  }

  @Get(':id')
  get(@Request() req, @Param('id') id: string) {
    return this.events.getEventById(id, req.adminClient.id);
  }

  @Post()
  create(@Request() req, @Body() dto: CreateEventDto) {
    return this.events.createEvent(req.adminClient.id, dto);
  }

  @Patch(':id')
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.updateEvent(id, req.adminClient.id, dto);
  }

  @Post(':id/publish')
  publish(@Request() req, @Param('id') id: string) {
    return this.events.publishEvent(id, req.adminClient.id);
  }

  @Post(':id/cancel')
  cancel(@Request() req, @Param('id') id: string) {
    return this.events.cancelEvent(id, req.adminClient.id);
  }

  @Get(':id/stats')
  stats(@Request() req, @Param('id') id: string) {
    return this.events.getEventStats(id, req.adminClient.id);
  }
}
```

> **Nessuna logica nuova**: ogni metodo delega al service esistente passando `req.adminClient.id`. Stesso pattern per participants (`getParticipants`, `addParticipant`, `addParticipantsBulk`, `updateParticipantStatus`, `removeParticipant`, `checkInParticipant`), categories (CRUD), tags (CRUD), webhooks (`getWebhookDeliveries`).

### 4. `src/modules/admin/admin.module.ts`

```typescript
@Module({
  imports: [BastionModule, EventModule, CategoryModule, TagModule, ClientModule],
  controllers: [
    AdminEventsController,
    AdminParticipantsController,
    AdminCategoriesController,
    AdminTagsController,
    AdminWebhooksController,
  ],
})
export class AdminModule {}
```

Registra `AdminModule` in `app.module.ts` imports.

### 5. `BastionJwtGuard` globale — escludere gli admin route

Il guard globale (`APP_GUARD BastionJwtGuard`) valida service-client su TUTTE le route. Gli admin route usano il loro guard → serve un `@Public()` o branch.

Opzioni:
- **A** (consigliata): il `BastionJwtGuard` globale legge `req.path.startsWith('/admin')` → `return true` (delega al guard di controller). Una riga.
- **B**: decorator `@Public()` (già pattern platform) su ogni admin controller. Ma "public" è fuorviante — sono protetti dal BastionUserGuard.

---

## Endpoint surface risultante

| Route | Metodi |
|---|---|
| `/admin/events` | GET(list), POST, GET/:id, PATCH/:id, POST/:id/publish, POST/:id/cancel, POST/:id/complete, GET/:id/stats |
| `/admin/events/:id/participants` | GET, POST, POST/bulk, PATCH/:pid/status, DELETE/:pid, POST/:pid/checkin |
| `/admin/categories` | GET, POST, GET/:id, PATCH/:id, DELETE/:id |
| `/admin/tags` | GET, POST, GET/:id, PATCH/:id, DELETE/:id |
| `/admin/webhooks/deliveries` | GET (con filtro status) |

> `clients` management (create/revoke/rotate) resta **fuori** dall'admin per-tenant — è cross-tenant, gestito da Meridian via Bastion, non da un admin di singolo tenant.

---

## Env richieste

Nessuna nuova. `BastionUserGuard` riusa `BASTION_URL` (JWKS) già presente.

---

## Breaking change

**No.** Route nuove additive. `/events`, `/categories`, `/tags` esistenti (service-client) invariati.

---

## Checklist

- [ ] `bastion-user.guard.ts` — verify + type/appSlug/role + resolve `req.adminClient`
- [ ] Export `BastionUserGuard` da `BastionModule`
- [ ] `admin-throttler.guard.ts` — `getTracker` per-utente
- [ ] `BastionJwtGuard` globale — skip `/admin/*`
- [ ] `admin-events.controller.ts` (+ participants) — delega a `EventService`
- [ ] `admin-categories.controller.ts` — delega a `CategoryService`
- [ ] `admin-tags.controller.ts` — delega a `TagService`
- [ ] `admin-webhooks.controller.ts` — delega a `ClientService.getWebhookDeliveries`
- [ ] `admin.module.ts` + registra in `app.module.ts`
- [ ] Verifica `appSlug='gatherly'` esista come App in Bastion + tenant grant (`TenantApp`)
- [ ] Swagger: tag `admin/*`, `@ApiBearerAuth()`
- [ ] Test e2e: JWT utente valido → 200; service-client su `/admin` → 401; role MEMBER → 403; cross-tenant isolation
- [ ] `graphify update .`
