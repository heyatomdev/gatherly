import { Injectable, Logger } from '@nestjs/common';
import { Registry, Histogram, Gauge, collectDefaultMetrics } from '@prometheus-io/client';
import { WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Prometheus metrics for gatherly. Uses its own `Registry` rather than the
 * @prometheus-io/client global one, so a `MetricsService` created per test (or per
 * NestJS TestingModule) never collides with metrics registered by another
 * test in the same process.
 *
 * The webhook gauges are computed lazily via a `collect()` callback — the
 * client only invokes it on scrape, so an idle process never runs these
 * queries. A failed query logs a warning and leaves the gauge at its last
 * value instead of failing the whole scrape.
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();
  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status'>;

  constructor(private readonly prisma: PrismaService) {
    this.registry.setDefaultLabels({ app: 'gatherly' });
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.registerWebhookGauges();
  }

  private registerWebhookGauges(): void {
    const deliveries = new Gauge({
      name: 'gatherly_webhook_deliveries',
      help: 'Webhook deliveries by status',
      labelNames: ['status'],
      registers: [this.registry],
      collect: async () => {
        try {
          const counts = await this.prisma.webhookDelivery.groupBy({
            by: ['status'],
            _count: true,
          });
          const byStatus = new Map(counts.map((c) => [c.status, c._count]));
          for (const status of Object.values(WebhookDeliveryStatus)) {
            deliveries.set({ status }, byStatus.get(status) ?? 0);
          }
        } catch (err) {
          this.logger.warn(
            `gatherly_webhook_deliveries collection failed: ${errorMessage(err)}`,
          );
        }
      },
    });

    // PENDING is the only non-terminal status: FAILED is final once
    // maxAttempts is reached (only a manual retry moves it back to PENDING).
    // Rows claimed by WebhookService.claimDue() carry a lease (nextRetryAt in
    // the future), so in-flight deliveries correctly don't count as overdue.
    const overdue = new Gauge({
      name: 'gatherly_webhook_deliveries_overdue',
      help: 'PENDING webhook deliveries past their nextRetryAt — the queue job runs every minute, so a value that stays non-zero means it is stuck',
      registers: [this.registry],
      collect: async () => {
        try {
          overdue.set(
            await this.prisma.webhookDelivery.count({
              where: {
                status: WebhookDeliveryStatus.PENDING,
                nextRetryAt: { lt: new Date() },
              },
            }),
          );
        } catch (err) {
          this.logger.warn(
            `gatherly_webhook_deliveries_overdue collection failed: ${errorMessage(err)}`,
          );
        }
      },
    });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
