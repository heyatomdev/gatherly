import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '@/modules/app/app.module';
import { BastionJwksService } from '@heyatom/bastion-client/nest';
import { PrismaService } from '@/modules/prisma/prisma.service';

/**
 * E2e coverage for the /admin/clients surface (SUPER_ADMIN only), and for the
 * fact that the old self-service /clients routes are gone entirely. Same
 * mocking approach as admin-auth.e2e-spec.ts — BastionJwksService is mocked,
 * PrismaService.client is stubbed per-test.
 */

const TENANT_ID = 'tenant-e2e';

// Mirrors a real Bastion USER token: it carries no `type` field (only machine
// tokens set `type: 'service_client'`). Overrides can add `type` to simulate one.
function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-e2e',
    tenantId: TENANT_ID,
    tenantSlug: 'acme',
    email: 'admin@acme.com',
    appSlug: 'gatherly',
    role: 'SUPER_ADMIN',
    iat: 0,
    exp: 9999999999,
    ...overrides,
  };
}

describe('Admin Clients API (e2e)', () => {
  let app: INestApplication;
  let jwks: jest.Mocked<BastionJwksService>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BastionJwksService)
      .useValue({ verify: jest.fn(), getJwks: jest.fn() })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    jwks = module.get(BastionJwksService);
    prisma = module.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Old public /clients routes are gone', () => {
    it('POST /clients returns 404', async () => {
      await request(app.getHttpServer()).post('/clients').send({ name: 'x' }).expect(404);
    });

    it('GET /clients returns 404', async () => {
      await request(app.getHttpServer()).get('/clients').expect(404);
    });
  });

  describe('GET /admin/clients', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/admin/clients').expect(401);
    });

    it('returns 403 with an ADMIN role (not SUPER_ADMIN)', async () => {
      jwks.verify.mockResolvedValue(makePayload({ role: 'ADMIN' }) as any);

      await request(app.getHttpServer())
        .get('/admin/clients')
        .set('Authorization', 'Bearer admin-token')
        .expect(403);
    });

    it('returns 200 with SUPER_ADMIN even when no client exists for the token tenant', async () => {
      jwks.verify.mockResolvedValue(makePayload() as any);
      // BastionSuperAdminGuard performs no client/tenant lookup — confirm the
      // route still succeeds when prisma has no client bound to this tenant.
      jest.spyOn(prisma.client, 'findMany').mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/admin/clients')
        .set('Authorization', 'Bearer super-admin-token')
        .expect(200);

      expect(prisma.client.findMany).toHaveBeenCalled();
    });

    it('returns 401 when token is a machine token (type "service_client")', async () => {
      jwks.verify.mockResolvedValue(makePayload({ type: 'service_client' }) as any);

      await request(app.getHttpServer())
        .get('/admin/clients')
        .set('Authorization', 'Bearer service-token')
        .expect(401);
    });

    it('returns 403 when appSlug is not allowlisted', async () => {
      jwks.verify.mockResolvedValue(makePayload({ appSlug: 'other' }) as any);

      await request(app.getHttpServer())
        .get('/admin/clients')
        .set('Authorization', 'Bearer other-app-token')
        .expect(403);
    });
  });
});
