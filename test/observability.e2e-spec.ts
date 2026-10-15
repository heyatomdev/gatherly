import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request = require('supertest');
import { MetricsServer } from '@heyatom/nest-common/metrics';
import { BastionJwksService } from '@heyatom/bastion-client/nest';
import { AppModule } from '@/modules/app/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { loggerConfig } from '@/configs/logger.config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Boots the real AppModule: request-id/access-log and metrics server wiring. */
describe('Observability (e2e)', () => {
  let app: INestApplication;
  let metricsUrl: string;
  const logLines: Array<Record<string, any>> = [];
  const accessLogs = () => logLines.filter((l) => l.msg === 'request completed');

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BastionJwksService)
      .useValue({ verify: jest.fn(), getJwks: jest.fn() })
      // gatherly's real logger params, writing JSON into logLines instead of pino-pretty.
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useFactory({
        inject: [ConfigService],
        factory: (config: ConfigService) => {
          const params = loggerConfig(config);
          const { transport, ...opts } = params.pinoHttp;
          const stream = { write: (line: string) => void logLines.push(JSON.parse(line)) };
          return { ...params, pinoHttp: [opts, stream] };
        },
      })
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

  beforeEach(() => {
    logLines.length = 0;
  });

  it('answers with a server-generated X-Request-Id, never the caller\'s', async () => {
    const res = await request(app.getHttpServer()).get('/nope').set('X-Request-Id', '<script>').expect(404);

    expect(res.headers['x-request-id']).toMatch(UUID);
    const [line] = accessLogs();
    expect(line.req.id).toBe(res.headers['x-request-id']);
    // Not a valid opaque token: not even logged as clientRequestId.
    expect(line.clientRequestId).toBeUndefined();
    expect(JSON.stringify(logLines)).not.toContain('<script>');
  });

  it('logs a well-formed caller id only as clientRequestId', async () => {
    const res = await request(app.getHttpServer()).get('/nope').set('X-Request-Id', 'caller-abc.1').expect(404);

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(accessLogs()[0]).toMatchObject({ service: 'gatherly', clientRequestId: 'caller-abc.1' });
  });

  it('does not log /health/live or /health/ready', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready');
    await request(app.getHttpServer()).get('/nope').expect(404);

    expect(accessLogs().map((l) => l.req.url)).toEqual(['/nope']);
  });

  it('keeps headers out of request logs', async () => {
    await request(app.getHttpServer())
      .get('/nope')
      .set('Authorization', 'Bearer secret-token')
      .set('Cookie', 'session=secret-cookie')
      .expect(404);

    expect(JSON.stringify(logLines)).not.toContain('secret-cookie');
    expect(JSON.stringify(logLines)).not.toContain('secret-token');
  });

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
    // Earlier tests in this file hit /nope too.
    expect(body).toMatch(
      /http_request_duration_seconds_count\{app="gatherly",method="GET",route="unmatched",status="404"\} \d+/,
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
