import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '@/modules/app/app.module';
import { BastionJwksService } from '@/modules/bastion/bastion-jwks.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

/**
 * E2e auth tests for /admin/* — BastionJwksService is mocked so no real
 * Bastion instance is needed. PrismaService.client is stubbed per-test.
 */

const TENANT_ID = 'tenant-e2e';
const CLIENT_ID = 'client-e2e';

const activeClient = {
  id: CLIENT_ID,
  tenantId: TENANT_ID,
  isActive: true,
  name: 'E2E Client',
  token: 'tok',
  defaultLocale: 'it',
  emailActive: false,
  webhookUrl: null,
  webhookSecret: 'secret',
  createdAt: new Date(),
  revokedAt: null,
};

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-e2e',
    tenantId: TENANT_ID,
    tenantSlug: 'acme',
    email: 'admin@acme.com',
    appSlug: 'gatherly',
    role: 'ADMIN',
    type: 'user',
    iat: 0,
    exp: 9999999999,
    ...overrides,
  };
}

describe('Admin API auth (e2e)', () => {
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

  describe('GET /admin/events', () => {
    it('returns 200 with valid ADMIN user JWT', async () => {
      jwks.verify.mockResolvedValue(makePayload() as any);
      jest.spyOn(prisma.client, 'findUnique').mockResolvedValue(activeClient as any);
      jest.spyOn(prisma.event, 'findMany').mockResolvedValue([]);
      jest.spyOn(prisma.event, 'count').mockResolvedValue(0);
      jest.spyOn(prisma, '$transaction').mockResolvedValue([[], 0] as any);

      await request(app.getHttpServer())
        .get('/admin/events')
        .set('Authorization', 'Bearer valid-user-token')
        .expect(200);
    });

    it('returns 401 when Authorization header is missing', async () => {
      await request(app.getHttpServer()).get('/admin/events').expect(401);
    });

    it('returns 401 when JWT type is "service_client"', async () => {
      jwks.verify.mockResolvedValue(makePayload({ type: 'service_client' }) as any);

      await request(app.getHttpServer())
        .get('/admin/events')
        .set('Authorization', 'Bearer service-token')
        .expect(401);
    });

    it('returns 403 when role is MEMBER', async () => {
      jwks.verify.mockResolvedValue(makePayload({ role: 'MEMBER' }) as any);

      await request(app.getHttpServer())
        .get('/admin/events')
        .set('Authorization', 'Bearer member-token')
        .expect(403);
    });

    it('returns 403 when appSlug is not "gatherly"', async () => {
      jwks.verify.mockResolvedValue(makePayload({ appSlug: 'other' }) as any);

      await request(app.getHttpServer())
        .get('/admin/events')
        .set('Authorization', 'Bearer other-app-token')
        .expect(403);
    });

    it('returns 403 when client is inactive', async () => {
      jwks.verify.mockResolvedValue(makePayload() as any);
      jest
        .spyOn(prisma.client, 'findUnique')
        .mockResolvedValue({ ...activeClient, isActive: false } as any);

      await request(app.getHttpServer())
        .get('/admin/events')
        .set('Authorization', 'Bearer valid-token')
        .expect(403);
    });

    it('returns 403 when no client exists for tenantId (cross-tenant isolation)', async () => {
      jwks.verify.mockResolvedValue(makePayload({ tenantId: 'unknown-tenant' }) as any);
      jest.spyOn(prisma.client, 'findUnique').mockResolvedValue(null);

      await request(app.getHttpServer())
        .get('/admin/events')
        .set('Authorization', 'Bearer unknown-tenant-token')
        .expect(403);
    });

    it('OWNER role is accepted', async () => {
      jwks.verify.mockResolvedValue(makePayload({ role: 'OWNER' }) as any);
      jest.spyOn(prisma.client, 'findUnique').mockResolvedValue(activeClient as any);
      jest.spyOn(prisma, '$transaction').mockResolvedValue([[], 0] as any);

      await request(app.getHttpServer())
        .get('/admin/events')
        .set('Authorization', 'Bearer owner-token')
        .expect(200);
    });
  });

  describe('Service-client token on /admin (global guard bypass)', () => {
    it('service-client Bearer token rejected by BastionUserGuard with 401', async () => {
      // Global BastionJwtGuard skips /admin/* — BastionUserGuard takes over
      // and rejects type !== 'user'
      jwks.verify.mockResolvedValue(
        makePayload({ type: 'service_client', role: undefined }) as any,
      );

      await request(app.getHttpServer())
        .get('/admin/events')
        .set('Authorization', 'Bearer service-client-token')
        .expect(401);
    });
  });
});
