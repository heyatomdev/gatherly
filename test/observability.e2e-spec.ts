import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { MetricsServer } from '@heyatom/nest-common/metrics';
import { BastionJwksService } from '@heyatom/bastion-client/nest';
import { AppModule } from '@/modules/app/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';

/** Boots the real AppModule: metrics server wiring. */
describe('Observability (e2e)', () => {
  let app: INestApplication;
  let metricsUrl: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BastionJwksService)
      .useValue({ verify: jest.fn(), getJwks: jest.fn() })
      .compile();

    app = module.createNestApplication();
    await app.init();

    // groupBy's generic signature is too deep for jest.spyOn's types.
    const deliveries = module.get(PrismaService).webhookDelivery as any;
    jest.spyOn(deliveries, 'groupBy').mockResolvedValue([{ status: 'PENDING', _count: 2 }]);
    jest.spyOn(deliveries, 'count').mockResolvedValue(1);
    metricsUrl = `http://127.0.0.1:${module.get(MetricsServer).port}/metrics`;
  });

  afterAll(() => app.close());

  it('serves /metrics on its own port with the HTTP histogram and the gatherly gauges', async () => {
    await request(app.getHttpServer()).get('/events').expect(401);
    await request(app.getHttpServer()).get('/nope').expect(404);
    await request(app.getHttpServer()).get('/health/live').expect(200);

    const res = await fetch(metricsUrl);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      'http_request_duration_seconds_count{app="gatherly",method="GET",route="/events",status="401"} 1',
    );
    expect(body).toContain(
      'http_request_duration_seconds_count{app="gatherly",method="GET",route="unmatched",status="404"} 1',
    );
    expect(body).not.toContain('route="/health');
    expect(body).toMatch(/gatherly_webhook_deliveries\{status="PENDING",app="gatherly"\} 2/);
    expect(body).toMatch(/gatherly_webhook_deliveries\{status="FAILED",app="gatherly"\} 0/);
    expect(body).toMatch(/gatherly_webhook_deliveries_overdue\{app="gatherly"\} 1/);
  });

  it('serves nothing on the API port', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(404);
  });
});
