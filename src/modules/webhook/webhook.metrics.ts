import { Injectable, Logger } from '@nestjs/common';
import { Gauge } from '@prometheus-io/client';
import { MetricsService } from '@heyatom/nest-common/metrics';
import { WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Gatherly's domain gauges, registered on the shared `MetricsService` registry
 * from `@heyatom/nest-common/metrics` (which owns the registry, the default
 * `app` label, `http_request_duration_seconds` and the `/metrics` server).
 *
 * Computed lazily via `collect()` — the client only invokes it on scrape, so
 * an idle process never runs these queries. A failed query logs a warning and
 * leaves the gauge at its last value instead of failing the whole scrape.
 */
@Injectable()
export class WebhookMetrics {
  private readonly logger = new Logger(WebhookMetrics.name);

  constructor(
    metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {
    const deliveries = new Gauge({
      name: 'gatherly_webhook_deliveries',
      help: 'Webhook deliveries by status',
      labelNames: ['status'],
      registers: [metrics.registry],
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
      registers: [metrics.registry],
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
