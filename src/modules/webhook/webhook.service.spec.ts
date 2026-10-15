import { createHmac } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLAIM_LEASE_MINUTES,
  QUEUE_BATCH_SIZE,
  WebhookService,
} from './webhook.service';
import { WebhookEventType } from './dto/webhook-event.dto';
import { AxiosError } from 'axios';
import {
  signStandardWebhook,
  webhookAgent,
  WebhookUrlError,
} from '@heyatom/nest-common/webhooks';

describe('WebhookService queue', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    webhookDelivery: { findMany: jest.fn(), update: jest.fn() },
    client: { findUnique: jest.fn() },
  };
  const http = { post: jest.fn() };
  const CURRENT_URL = 'https://current.example.test/hook';
  let service: WebhookService;

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    clientId: 'c1',
    webhookUrl: 'https://example.test/hook',
    payload: { event: 'event.created' },
    attempts: 0,
    maxAttempts: 5,
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.client.findUnique.mockResolvedValue({
      webhookUrl: CURRENT_URL,
      webhookSecret: 's',
    });
    service = new WebhookService(
      http as unknown as HttpService,
      prisma as unknown as PrismaService,
    );
  });

  it('claims with a single leased UPDATE ... FOR UPDATE SKIP LOCKED', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    expect(await service.claimDue()).toEqual([]);

    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?').replace(/\s+/g, ' ');
    expect(sql).toContain(
      'UPDATE webhook_deliveries SET "nextRetryAt" = now() + make_interval(mins => ?)',
    );
    expect(sql).toContain(
      `WHERE status = 'PENDING' AND "nextRetryAt" <= now()`,
    );
    expect(sql).toContain(
      'ORDER BY "nextRetryAt" LIMIT ? FOR UPDATE SKIP LOCKED',
    );
    expect(sql).toContain('RETURNING id');
    expect(values).toEqual([CLAIM_LEASE_MINUTES, QUEUE_BATCH_SIZE]);
    expect(prisma.webhookDelivery.findMany).not.toHaveBeenCalled();
  });

  it('only loads and sends the rows it claimed', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'd1' }]);
    prisma.webhookDelivery.findMany.mockResolvedValue([row()]);
    http.post.mockReturnValue(of({ status: 200 }));

    await service.processQueue();

    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['d1'] } },
    });
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: 'DELIVERED', attempts: 1 },
    });
  });

  it('reschedules with backoff on failure, replacing the lease', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'd1' }]);
    prisma.webhookDelivery.findMany.mockResolvedValue([row({ attempts: 1 })]);
    http.post.mockReturnValue(throwError(() => new Error('boom')));
    const before = Date.now();

    await service.processQueue();

    const { data } = prisma.webhookDelivery.update.mock.calls[0][0];
    expect(data).toMatchObject({
      attempts: 2,
      status: 'PENDING',
      lastError: 'Delivery failed',
    });
    // 2^2 * 30s = 120s — well under the 5-minute lease
    expect(data.nextRetryAt.getTime() - before).toBeGreaterThanOrEqual(120_000);
    expect(data.nextRetryAt.getTime() - before).toBeLessThan(121_000);
  });

  it("sends to the client's current URL, not the one stored at enqueue time", async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'd1' }]);
    prisma.webhookDelivery.findMany.mockResolvedValue([
      row({ webhookUrl: 'https://old.example.test/hook' }),
    ]);
    http.post.mockReturnValue(of({ status: 200 }));

    await service.processQueue();

    expect(http.post.mock.calls[0][0]).toBe(CURRENT_URL);
  });

  it('marks FAILED without sending when the client cleared its URL', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'd1' }]);
    prisma.webhookDelivery.findMany.mockResolvedValue([row()]);
    prisma.client.findUnique.mockResolvedValue({
      webhookUrl: null,
      webhookSecret: 's',
    });

    await service.processQueue();

    expect(http.post).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { status: 'FAILED', lastError: 'Webhook URL removed' },
    });
  });

  it('sends Standard Webhooks headers signed over id.timestamp.body, plus the legacy signature', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'd1' }]);
    const payload = {
      id: 'd1',
      event: 'event.created',
      timestamp: '2020-01-01T00:00:00.000Z',
    };
    prisma.webhookDelivery.findMany.mockResolvedValue([row({ payload })]);
    http.post.mockReturnValue(of({ status: 200 }));
    const before = Math.floor(Date.now() / 1000);

    await service.processQueue();

    const [, body, { headers, httpsAgent, maxRedirects }] =
      http.post.mock.calls[0];
    expect(httpsAgent).toBe(webhookAgent);
    expect(maxRedirects).toBe(0);
    expect(body).toBe(JSON.stringify(payload));
    expect(headers['webhook-id']).toBe('d1');
    // Send time, not the enqueue-time body timestamp.
    const ts = Number(headers['webhook-timestamp']);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(before + 2);
    const expected = createHmac('sha256', 's')
      .update(`d1.${headers['webhook-timestamp']}.${body}`)
      .digest('base64');
    expect(headers['webhook-signature']).toBe(`v1,${expected}`);
    expect(headers['X-Webhook-Signature']).toBe(
      'sha256=' + createHmac('sha256', 's').update(body).digest('hex'),
    );
  });

  it('signStandardWebhook matches the pre-package signature byte for byte', () => {
    // The removed WebhookService.signStandard, verbatim.
    const legacy = (
      secret: string,
      id: string,
      timestamp: string,
      body: string,
    ) =>
      'v1,' +
      createHmac('sha256', secret)
        .update(`${id}.${timestamp}.${body}`)
        .digest('base64');
    const secret = 'a3f1c0de'.repeat(8);
    const body = JSON.stringify({
      id: 'd1',
      event: 'participant.joined',
      data: { userName: 'Zoë ✓' },
    });

    expect(
      signStandardWebhook({
        id: 'd1',
        timestamp: 1760000000,
        body,
        secrets: [secret],
      }),
    ).toEqual({
      'webhook-id': 'd1',
      'webhook-timestamp': '1760000000',
      'webhook-signature': legacy(secret, 'd1', '1760000000', body),
    });
  });

  it.each([
    'http://example.test/hook',
    'https://127.0.0.1/hook',
    'https://user:pass@example.test/hook',
  ])(
    'marks a stored blocked URL FAILED without sending or retrying: %s',
    async (url) => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'd1' }]);
      prisma.webhookDelivery.findMany.mockResolvedValue([row()]);
      prisma.client.findUnique.mockResolvedValue({
        webhookUrl: url,
        webhookSecret: 's',
      });

      await service.processQueue();

      expect(http.post).not.toHaveBeenCalled();
      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { status: 'FAILED', attempts: 1, lastError: 'Delivery failed' },
      });
    },
  );

  it('marks FAILED without retry when the agent refuses the resolved address (DNS rebinding)', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'd1' }]);
    prisma.webhookDelivery.findMany.mockResolvedValue([row()]);
    // What axios hands back when webhookAgent's lookup rejects: an AxiosError wrapping the guard error.
    const blocked = new WebhookUrlError('DNS_NON_PUBLIC');
    const err = AxiosError.from(blocked, blocked.code);
    expect(err.cause).toBe(blocked);
    http.post.mockReturnValue(throwError(() => err));

    await service.processQueue();

    const { data } = prisma.webhookDelivery.update.mock.calls[0][0];
    expect(data).toMatchObject({
      attempts: 1,
      status: 'FAILED',
      lastError: 'Delivery failed',
    });
    expect(data.nextRetryAt).toBeUndefined();
  });

  it('keeps a plain network error retryable', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'd1' }]);
    prisma.webhookDelivery.findMany.mockResolvedValue([row()]);
    http.post.mockReturnValue(
      throwError(() =>
        AxiosError.from(
          Object.assign(new Error('connect ECONNREFUSED'), {
            code: 'ECONNREFUSED',
          }),
          'ECONNREFUSED',
        ),
      ),
    );

    await service.processQueue();

    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({
      attempts: 1,
      status: 'PENDING',
      lastError: 'Delivery failed',
    });
  });

  it('marks FAILED at maxAttempts', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'd1' }]);
    prisma.webhookDelivery.findMany.mockResolvedValue([row({ attempts: 4 })]);
    http.post.mockReturnValue(throwError(() => new Error('boom')));

    await service.processQueue();

    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({
      attempts: 5,
      status: 'FAILED',
      nextRetryAt: undefined,
    });
  });
});

describe('WebhookService notify/cleanup/retry', () => {
  const prisma = {
    client: { findUnique: jest.fn() },
    webhookDelivery: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    withAdvisoryLock: jest.fn(async (_name: string, fn: any) => fn(prisma)),
  };
  const service = new WebhookService(
    {} as HttpService,
    prisma as unknown as PrismaService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('sends trimmed event and participant payloads without contact data', async () => {
    prisma.client.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.test/hook',
    });

    await service.notify('c1', WebhookEventType.EVENT_PUBLISHED, {
      id: 'e1',
      defaultLocale: 'it',
      translations: [{ locale: 'it', title: 'Torneo' }],
      tags: [{ tag: { slug: '5v5' } }],
      participants: [{ id: 'p1', email: 'mario@example.com' }],
    });
    await service.notify(
      'c1',
      WebhookEventType.PARTICIPANT_STATUS_CHANGED,
      [
        {
          id: 'p1',
          eventId: 'e1',
          userName: 'Mario',
          email: 'mario@example.com',
          notes: 'vip',
          status: 'REGISTERED',
        },
      ],
      { previousStatus: 'WAITLIST' },
    );

    const event = prisma.webhookDelivery.createMany.mock.calls[0][0].data[0];
    expect(event).toMatchObject({
      clientId: 'c1',
      eventType: 'event.published',
    });
    expect(event.payload.data).toMatchObject({
      id: 'e1',
      title: 'Torneo',
      tags: ['5v5'],
    });

    const participant =
      prisma.webhookDelivery.createMany.mock.calls[1][0].data[0].payload.data;
    expect(participant).toMatchObject({
      id: 'p1',
      status: 'REGISTERED',
      previousStatus: 'WAITLIST',
    });

    const all = JSON.stringify(prisma.webhookDelivery.createMany.mock.calls);
    expect(all).not.toContain('mario@example.com');
    expect(all).not.toContain('vip');
  });

  it('gives each delivery a payload id equal to its row id (consumer dedupe key)', async () => {
    prisma.client.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.test/hook',
    });

    await service.notify('c1', WebhookEventType.PARTICIPANT_JOINED, [
      { id: 'p1', eventId: 'e1' },
      { id: 'p2', eventId: 'e1' },
    ]);

    const rows = prisma.webhookDelivery.createMany.mock.calls[0][0].data;
    expect(rows[0].id).toEqual(expect.any(String));
    expect(rows[0].payload.id).toBe(rows[0].id);
    expect(rows[1].payload.id).toBe(rows[1].id);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it('refuses a manual retry when the client has no webhookUrl', async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue({
      id: 'd1',
      status: 'FAILED',
    });
    prisma.client.findUnique.mockResolvedValue({ webhookUrl: null });

    await expect(service.retryDelivery('d1', 'c1')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
  });

  it('requeues a FAILED delivery when the client has a webhookUrl', async () => {
    prisma.webhookDelivery.findFirst.mockResolvedValue({
      id: 'd1',
      status: 'FAILED',
    });
    prisma.client.findUnique.mockResolvedValue({
      webhookUrl: 'https://example.test/hook',
    });

    await service.retryDelivery('d1', 'c1');

    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({
      status: 'PENDING',
      attempts: 0,
    });
  });

  it('enqueues nothing when the client has no webhookUrl', async () => {
    prisma.client.findUnique.mockResolvedValue({ webhookUrl: null });

    await service.notify('c1', WebhookEventType.EVENT_CREATED, { id: 'e1' });

    expect(prisma.webhookDelivery.createMany).not.toHaveBeenCalled();
  });

  it('cleans up old DELIVERED and FAILED rows under an advisory lock', async () => {
    await service.cleanupDeliveries();

    expect(prisma.withAdvisoryLock).toHaveBeenCalledWith(
      'webhook.cleanupDeliveries',
      expect.any(Function),
    );
    const { where } = prisma.webhookDelivery.deleteMany.mock.calls[0][0];
    expect(where.OR.map((c: any) => c.status)).toEqual(['DELIVERED', 'FAILED']);
  });
});
