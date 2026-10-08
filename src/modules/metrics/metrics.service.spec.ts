import { Logger } from '@nestjs/common';
import { WebhookDeliveryStatus } from '@prisma/client';
import { MetricsService } from './metrics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MetricsService', () => {
  let service: MetricsService;
  const mockPrisma = {
    webhookDelivery: { groupBy: jest.fn(), count: jest.fn() },
  };

  async function gaugeValue(
    name: string,
    labels?: Record<string, string>,
  ): Promise<number | undefined> {
    const metric = service.registry.getSingleMetric(name);
    const { values } = await (
      metric as {
        get(): Promise<{
          values: Array<{ labels: Record<string, string>; value: number }>;
        }>;
      }
    ).get();
    if (!labels) return values[0]?.value;
    return values.find((v) =>
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
    )?.value;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MetricsService(mockPrisma as unknown as PrismaService);
  });

  it('gatherly_webhook_deliveries always emits every enum value, 0 when absent', async () => {
    mockPrisma.webhookDelivery.groupBy.mockResolvedValue([
      { status: WebhookDeliveryStatus.PENDING, _count: 3 },
    ]);

    for (const status of Object.values(WebhookDeliveryStatus)) {
      expect(
        await gaugeValue('gatherly_webhook_deliveries', { status }),
      ).toBe(status === WebhookDeliveryStatus.PENDING ? 3 : 0);
    }
  });

  it('gatherly_webhook_deliveries_overdue counts PENDING rows past nextRetryAt', async () => {
    mockPrisma.webhookDelivery.count.mockResolvedValue(5);

    expect(await gaugeValue('gatherly_webhook_deliveries_overdue')).toBe(5);
    expect(mockPrisma.webhookDelivery.count).toHaveBeenCalledWith({
      where: {
        status: WebhookDeliveryStatus.PENDING,
        nextRetryAt: { lt: expect.any(Date) },
      },
    });
  });

  it('runs no query until scraped', () => {
    expect(mockPrisma.webhookDelivery.groupBy).not.toHaveBeenCalled();
    expect(mockPrisma.webhookDelivery.count).not.toHaveBeenCalled();
  });

  it('a DB error during collection logs a warning and leaves the gauge at its last value', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    mockPrisma.webhookDelivery.count.mockResolvedValueOnce(7);
    await gaugeValue('gatherly_webhook_deliveries_overdue');

    mockPrisma.webhookDelivery.count.mockRejectedValueOnce(
      new Error('db down'),
    );

    expect(await gaugeValue('gatherly_webhook_deliveries_overdue')).toBe(7);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('gatherly_webhook_deliveries_overdue'),
    );
    warnSpy.mockRestore();
  });
});
