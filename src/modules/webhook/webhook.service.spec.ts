import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../prisma/prisma.service';
import { CLAIM_LEASE_MINUTES, QUEUE_BATCH_SIZE, WebhookService } from './webhook.service';

describe('WebhookService queue', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    webhookDelivery: { findMany: jest.fn(), update: jest.fn() },
    client: { findUnique: jest.fn() },
  };
  const http = { post: jest.fn() };
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
    prisma.client.findUnique.mockResolvedValue({ webhookSecret: 's' });
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
    expect(sql).toContain('UPDATE webhook_deliveries SET "nextRetryAt" = now() + make_interval(mins => ?)');
    expect(sql).toContain(`WHERE status = 'PENDING' AND "nextRetryAt" <= now()`);
    expect(sql).toContain('ORDER BY "nextRetryAt" LIMIT ? FOR UPDATE SKIP LOCKED');
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
    expect(data).toMatchObject({ attempts: 2, status: 'PENDING', lastError: 'boom' });
    // 2^2 * 30s = 120s — well under the 5-minute lease
    expect(data.nextRetryAt.getTime() - before).toBeGreaterThanOrEqual(120_000);
    expect(data.nextRetryAt.getTime() - before).toBeLessThan(121_000);
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
