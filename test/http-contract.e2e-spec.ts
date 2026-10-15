import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request = require('supertest');
import { BastionJwksService } from '@heyatom/bastion-client/nest';
import { createOpenApiDocument } from '@heyatom/nest-common';
import { AppModule } from '@/modules/app/app.module';
import { APP_VERSION } from '@/common/app-version';
import { PrismaService } from '@/modules/prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const adminClient = { id: 'client-e2e', tenantId: 'tenant-e2e', isActive: true };
// A Bastion user token for an ADMIN of tenant-e2e (see admin-auth.e2e-spec.ts).
const adminPayload = {
  sub: 'user-e2e',
  tenantId: 'tenant-e2e',
  tenantSlug: 'acme',
  email: 'admin@acme.com',
  appSlug: 'gatherly',
  role: 'ADMIN',
  iat: 0,
  exp: 9999999999,
};

/**
 * Platform HTTP contract (api.md §2–§3) as wired by AppModule — no main.ts
 * bootstrap, so only what is registered as APP_* providers is under test.
 */
describe('HTTP contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const admin = (req: request.Test) => req.set('Authorization', 'Bearer user-jwt');

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BastionJwksService)
      .useValue({ verify: jest.fn(), getJwks: jest.fn() })
      .compile();
    app = module.createNestApplication();
    // main.ts's pipe (setupHttpApp); everything else under test comes from AppModule.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    module.get(BastionJwksService).verify = jest.fn().mockResolvedValue(adminPayload);
    prisma = module.get(PrismaService);
  });

  afterAll(() => app.close());

  afterEach(() => jest.restoreAllMocks());

  beforeEach(() => {
    jest.spyOn(prisma.client, 'findUnique').mockResolvedValue(adminClient as any);
  });

  it('400 validation → VALIDATION_FAILED with errors[] and the request id', async () => {
    const res = await admin(request(app.getHttpServer()).post('/admin/tags').send({ bogus: 1 })).expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED', message: 'Validation failed' });
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringContaining('slug')]));
    expect(res.body.requestId).toMatch(UUID);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('404 → NOT_FOUND', async () => {
    jest.spyOn(prisma.tag, 'findFirst').mockResolvedValue(null);
    const res = await admin(request(app.getHttpServer()).get('/admin/tags/nope')).expect(404);

    expect(res.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', message: 'Tag nope not found' });
  });

  it('unhandled Prisma P2002 → 409 CONFLICT', async () => {
    jest
      .spyOn(prisma.tag, 'create')
      .mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'test' }));
    const res = await admin(request(app.getHttpServer()).post('/admin/tags').send({ slug: 'yoga' })).expect(409);

    expect(res.body).toMatchObject({ statusCode: 409, code: 'CONFLICT', message: 'Resource already exists' });
  });

  it('500 → generic message, nothing leaked, request id present', async () => {
    jest.spyOn(prisma.tag, 'findMany').mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432'));
    const res = await admin(request(app.getHttpServer()).get('/admin/tags')).expect(500);

    expect(res.body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId: expect.stringMatching(UUID),
    });
  });

  it('domain errors keep their code: blocked webhook URL → 400 WEBHOOK_TARGET_BLOCKED', async () => {
    const res = await admin(
      request(app.getHttpServer()).patch('/admin/settings').send({ webhookUrl: 'https://user:pass@example.com/hook' }),
    ).expect(400);

    expect(res.body).toMatchObject({
      statusCode: 400,
      code: 'WEBHOOK_TARGET_BLOCKED',
      message: 'webhook target blocked: credentials in URL are not allowed',
    });
  });

  it('wraps 2xx bodies in { data }', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });

  it('builds the OpenAPI document with title, version and paginated list schemas', () => {
    const doc = createOpenApiDocument(app, { title: 'Gatherly', version: APP_VERSION });

    expect(doc.info).toMatchObject({ title: 'Gatherly', version: require('../package.json').version });
    const list = doc.paths['/events'].get!.responses['200'] as any;
    expect(list.content['application/json'].schema.properties.meta.$ref).toBe('#/components/schemas/PageMetaDto');
  });
});
