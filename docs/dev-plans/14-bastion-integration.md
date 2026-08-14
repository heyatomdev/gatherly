# Dev Plan 14 — Bastion Integration

**Goal**: Replace Gatherly's custom `X-Client-Token` auth with Bastion JWT RS256.  
Each API consumer (gym, gaming org) authenticates via Bastion service-client JWT.  
Inter-service calls from other platform services also use Bastion JWT.

---

## Scope

| # | Area | What changes |
|---|------|-------------|
| 1 | `BastionModule` | New module — JWKS fetch/cache, JWT verify, service-client auth, audit |
| 2 | Global guard | Replace per-controller `ClientAuthGuard` with global `BastionJwtGuard` |
| 3 | `@Public()` | Move/unify decorator; mark endpoints that skip auth |
| 4 | Controllers | Replace `req.client` / `@Request()` with `@CurrentUser()` (`JwtPayload`) |
| 5 | Config | Add Bastion env vars to schema + Joi validation |
| 6 | Audit | Fire-and-forget `BastionAuditService.write()` on key domain events |
| 7 | Packages | `pnpm add jose cookie-parser @types/cookie-parser` |

**Out of scope (this plan)**: retiring the `Client` DB model + related CRUD endpoints  
(clients still exist in DB as tenant records; their token column becomes unused and can be dropped in a follow-up migration).

---

## Architecture decision

**Auth model after migration**:

```
External consumer (gym backend)
  → POST bastion:3001/auth/client { apiKey, serviceSlug: "gatherly", tenantSlug }
  ← RS256 JWT (TTL 1h), payload.type = "service_client"

  → GET gatherly:3000/events  Authorization: Bearer <jwt>
     BastionJwtGuard verifies locally via JWKS (no Bastion call per request)
     req.user = JwtPayload { sub, tenantId, tenantSlug, role, ... }
```

`tenantSlug` from the JWT replaces `clientId` for DB scoping  
(or map `tenantSlug` → `clientId` via a lookup if you want to keep the Client model as the DB anchor).

---

## Step-by-step

### Step 1 — Install packages

```bash
cd gatherly
pnpm add jose cookie-parser
pnpm add -D @types/cookie-parser
```

### Step 2 — Create `src/modules/bastion/`

Files to create (boilerplate from `docs/BASTION_INTEGRATION.md`):

```
src/modules/bastion/
  bastion.module.ts
  bastion.service.ts
  bastion-jwks.service.ts
  bastion-audit.service.ts
  bastion.types.ts
  guards/
    bastion-jwt.guard.ts
  decorators/
    current-user.decorator.ts
    public.decorator.ts          ← replaces src/decorators/public.decorator.ts
```

**`bastion.types.ts`** — `JwtPayload`, `TokenResponse`, `LoginResponse` (copy from integration guide).

**`bastion-jwks.service.ts`** — fetches JWKS from `BASTION_URL/.well-known/jwks.json`, caches `BASTION_JWKS_TTL_MS` (default 1h), verifies RS256.

**`bastion.service.ts`** — HTTP wrapper for all Bastion calls. For Gatherly, only `clientAuth()` and `writeAuditEvent()` are needed initially; include full boilerplate for future use.

**`bastion-jwt.guard.ts`** — reads `Authorization: Bearer <token>`, calls `BastionJwksService.verify()`, attaches `req.user`. Returns 401 on missing/invalid token. Respects `@Public()` metadata key `isPublic`.

**`bastion-audit.service.ts`** — token-rotating wrapper. `onModuleInit` fetches first token. Exposes `write(event, opts)` (fire-and-forget, never throws).

**`bastion.module.ts`**:
```typescript
@Module({
  imports: [ConfigModule],
  providers: [BastionService, BastionJwksService, BastionAuditService],
  exports: [BastionService, BastionJwksService, BastionAuditService],
})
export class BastionModule {}
```

### Step 3 — Register global guard in `AppModule`

```typescript
// app.module.ts
import { BastionModule } from '@/modules/bastion/bastion.module';
import { BastionJwtGuard } from '@/modules/bastion/guards/bastion-jwt.guard';

// imports: [..., BastionModule]
// providers: [
//   { provide: APP_GUARD, useClass: ThrottlerGuard },   // keep — runs first
//   { provide: APP_GUARD, useClass: BastionJwtGuard },  // add — runs second
// ]
```

Remove `ClientAuthGuard` from all controller `@UseGuards()` decorators.

### Step 4 — Update `@Public()` usage

Delete `src/decorators/public.decorator.ts` (now lives in bastion module).  
Update all imports across the codebase:
```typescript
// before
import { Public } from '@/decorators/public.decorator';
// after
import { Public } from '@/modules/bastion/decorators/public.decorator';
```

Endpoints that need `@Public()`:
- `POST /clients` (create new client — no token yet)
- `GET /clients` (list)
- `GET /health`

All other routes are protected by default.

### Step 5 — Update controllers

Replace `@Request() req` + `req.client` pattern with `@CurrentUser() user: JwtPayload`.

Controllers affected:
- `client.controller.ts` — remove `ClientAuthGuard`, keep `@Public()` on exempt routes
- `event.controller.ts` — swap `req.client.id` → `user.tenantId` (or lookup)
- `category.controller.ts` — same
- `tag.controller.ts` — same

**DB scoping**: where code currently does `where: { clientId: req.client.id }`,  
choose one of:
- **Option A** (simple): use `user.tenantId` directly as the scope key — requires renaming `clientId` → `tenantId` in schema (migration needed)
- **Option B** (no schema change): lookup `Client` by `tenantSlug: user.tenantSlug` on each request to resolve `clientId`

Recommendation: **Option B** for now (zero migration risk); follow-up plan can rename the column.

### Step 6 — Update config validation (`config.validation.ts`)

Add to `EnvironmentVariables`:

```typescript
@IsString()
BASTION_URL!: string;

@IsString()
BASTION_APP_SLUG!: string;   // = "gatherly"

@IsOptional()
@IsString()
BASTION_TENANT_SLUG?: string;

@IsString()
BASTION_CLIENT_API_KEY!: string;

@IsOptional()
@IsNumber()
BASTION_JWKS_TTL_MS: number = 3_600_000;
```

Update `.env.example`:
```env
BASTION_URL=http://bastion:3001
BASTION_APP_SLUG=gatherly
BASTION_CLIENT_API_KEY=sc_xxxx...
# BASTION_TENANT_SLUG=   # only if single-tenant
# BASTION_JWKS_TTL_MS=3600000
```

### Step 7 — Add audit writes

Minimal set of audit events for first iteration:

| Service method | Audit event |
|---|---|
| `EventService.create()` | `event.created` |
| `EventService.update()` | `event.updated` |
| `EventService.cancel()` | `event.cancelled` |
| `EventService.complete()` | `event.completed` |
| `EventService.addParticipant()` | `participant.joined` |
| `EventService.removeParticipant()` | `participant.removed` |

Pattern (fire-and-forget, never on hot path):
```typescript
this.audit.write('event.created', {
  userId: user.sub,
  metadata: { eventId: event.id, tenantSlug: user.tenantSlug },
}).catch(() => {}); // BastionAuditService already catches internally
```

Inject `BastionAuditService` into `EventModule` — add `BastionModule` to `EventModule` imports.

### Step 8 — `main.ts` additions

```typescript
import cookieParser from 'cookie-parser';
app.use(cookieParser());
```

(Cookie support needed for potential future user-facing Bastion flows; adds no cost now.)

---

## Files modified

| File | Change |
|------|--------|
| `src/modules/bastion/*` | **NEW** — 8 files |
| `src/modules/app/app.module.ts` | Add BastionModule, add BastionJwtGuard as APP_GUARD |
| `src/configs/config.validation.ts` | Add 4 Bastion env vars |
| `src/guards/client-auth.guard.ts` | **DELETE** (replaced by BastionJwtGuard) |
| `src/decorators/public.decorator.ts` | **DELETE** (moved into bastion module) |
| `src/modules/clients/client.controller.ts` | Remove ClientAuthGuard, add @Public() on exempt routes |
| `src/modules/events/event.controller.ts` | Swap req.client → @CurrentUser() |
| `src/modules/events/event.service.ts` | Add BastionAuditService injection + writes |
| `src/modules/events/event.module.ts` | Import BastionModule |
| `src/modules/categories/category.controller.ts` | Swap req.client → @CurrentUser() |
| `src/modules/tags/tag.controller.ts` | Swap req.client → @CurrentUser() |
| `src/main.ts` | Add cookieParser() |
| `.env.example` | Add Bastion vars |
| `gatherly/CLAUDE.md` | Update auth section |

---

## Checklist

- [ ] Step 1 — `pnpm add jose cookie-parser @types/cookie-parser`
- [ ] Step 2 — Create BastionModule (8 files)
- [ ] Step 3 — Wire global guard in AppModule
- [ ] Step 4 — Delete old `@Public()`, update imports
- [ ] Step 5 — Update controllers (req.client → @CurrentUser)
- [ ] Step 6 — Extend config validation
- [ ] Step 7 — Add audit writes in EventService
- [ ] Step 8 — `main.ts` cookieParser
- [ ] Register Gatherly as service-client in Bastion admin (one-time manual step)
- [ ] `graphify update .`

---

## Risk notes

- **No JWKS on startup**: if Bastion unreachable at boot, `BastionAuditService.onModuleInit` fails → app won't start. Wrap with try/catch + warn, don't throw.
- **DB scoping**: current `clientId` FK on all entities must still be populated. Option B (lookup by tenantSlug) adds one DB query per auth'd request — acceptable.
- **Token column**: `Client.token` becomes unused after migration. Leave it for now; drop in follow-up with `pnpm exec prisma migrate dev --name remove-client-token`.
