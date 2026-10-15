import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { BastionJwksService } from '@heyatom/bastion-client/nest';
import { AppModule } from '@/modules/app/app.module';

/**
 * Platform HTTP contract (api.md §2–§3) as wired by AppModule — no main.ts
 * bootstrap, so only what is registered as APP_* providers is under test.
 */
describe('HTTP contract (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BastionJwksService)
      .useValue({ verify: jest.fn(), getJwks: jest.fn() })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('wraps 2xx bodies in { data }', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });
});
