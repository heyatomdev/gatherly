import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { checkWebhookUrl, webhookAgent } from './webhook-url';
import { formatEventForWebhook, formatParticipantForWebhook } from './webhook.helper';
import { WebhookEventType } from './dto/webhook-event.dto';

/** Rows claimed per queue tick — see `claimDue`. */
export const QUEUE_BATCH_SIZE = 50;

/**
 * How long a claimed row stays invisible to other replicas. Must comfortably
 * exceed the 10s HTTP timeout in `attempt()`.
 */
export const CLAIM_LEASE_MINUTES = 5;

const DELIVERED_RETENTION_DAYS = 30;
/** Kept longer than DELIVERED so tenants can inspect and manually retry. */
const FAILED_RETENTION_DAYS = 90;

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private httpService: HttpService,
    private prisma: PrismaService,
  ) {}

  private signPayload(secret: string, body: string): string {
    return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  }

  @Cron('* * * * *')
  async processQueue(): Promise<void> {
    const due = await this.claimDue();
    await Promise.allSettled(due.map((d) => this.attempt(d)));
  }

  /**
   * Atomically claims up to QUEUE_BATCH_SIZE due rows by pushing their
   * nextRetryAt forward by the lease. SKIP LOCKED lets concurrent replicas
   * (or an overlapping tick) each take a disjoint batch; if the claiming
   * worker dies mid-delivery the row becomes due again when the lease runs
   * out. `attempt()` overwrites nextRetryAt / status either way, so the
   * lease never leaks into the backoff schedule.
   *
   * `$queryRaw` because Prisma expresses neither `SKIP LOCKED` nor
   * `UPDATE ... RETURNING` over a subquery. Columns aren't @map'ed, hence the
   * quoted camelCase.
   */
  async claimDue() {
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE webhook_deliveries
         SET "nextRetryAt" = now() + make_interval(mins => ${CLAIM_LEASE_MINUTES})
       WHERE id IN (
         SELECT id FROM webhook_deliveries
          WHERE status = 'PENDING' AND "nextRetryAt" <= now()
          ORDER BY "nextRetryAt"
          LIMIT ${QUEUE_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
       )
       RETURNING id
    `;
    if (claimed.length === 0) return [];

    return this.prisma.webhookDelivery.findMany({
      where: { id: { in: claimed.map((row) => row.id) } },
    });
  }

  private async attempt(delivery: any): Promise<void> {
    const attempts = delivery.attempts + 1;

    try {
      // Re-checked at send time: URLs stored before validation existed, and DNS can change.
      checkWebhookUrl(delivery.webhookUrl);
      const body = JSON.stringify(delivery.payload);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Gatherly/1.0 Webhook',
      };

      const client = await this.prisma.client.findUnique({
        where: { id: delivery.clientId },
        select: { webhookSecret: true },
      });
      if (client?.webhookSecret) {
        headers['X-Webhook-Signature'] = this.signPayload(client.webhookSecret, body);
      }

      await firstValueFrom(
        this.httpService.post(delivery.webhookUrl, body, {
          headers,
          httpsAgent: webhookAgent,
          maxRedirects: 0,
          maxContentLength: 64 * 1024,
          responseType: 'text',
          timeout: 10_000,
          signal: AbortSignal.timeout(10_000),
        }),
      );

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'DELIVERED', attempts },
      });
    } catch (error: any) {
      const backoffSeconds = Math.pow(2, attempts) * 30;
      const failed = attempts >= delivery.maxAttempts;

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          status: failed ? 'FAILED' : 'PENDING',
          nextRetryAt: failed ? undefined : new Date(Date.now() + backoffSeconds * 1000),
          // Generic on purpose: raw socket errors (ECONNREFUSED vs timeout…) are a port-scan oracle.
          lastError: error?.response?.status ? `HTTP ${error.response.status}` : 'Delivery failed',
        },
      });

      this.logger.debug(`Webhook delivery ${delivery.id} failed: ${error?.message}`);
      if (failed) {
        this.logger.error(
          `Webhook permanently failed after ${attempts} attempts: ${delivery.webhookUrl}`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async cleanupDeliveries(): Promise<void> {
    const day = 24 * 60 * 60 * 1000;
    const delivered = new Date(Date.now() - DELIVERED_RETENTION_DAYS * day);
    const failed = new Date(Date.now() - FAILED_RETENTION_DAYS * day);
    await this.prisma.withAdvisoryLock('webhook.cleanupDeliveries', (tx) =>
      tx.webhookDelivery.deleteMany({
        where: {
          OR: [
            { status: 'DELIVERED', updatedAt: { lt: delivered } },
            { status: 'FAILED', updatedAt: { lt: failed } },
          ],
        },
      }),
    );
  }

  async retryDelivery(deliveryId: string, clientId: string): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, clientId },
    });
    if (!delivery) throw new NotFoundException('Webhook delivery not found');
    if (delivery.status !== 'FAILED') {
      throw new BadRequestException('Only FAILED deliveries can be retried');
    }
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'PENDING', attempts: 0, nextRetryAt: new Date(), lastError: null },
    });
  }

  /**
   * Enqueues one delivery per item for the client's webhookUrl (no-op when
   * unset). Payloads are always built here from the trimmed formatters, so no
   * caller can leak participant lists or contact data.
   */
  async notify(
    clientId: string,
    type: WebhookEventType,
    items: any | any[],
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const list = Array.isArray(items) ? items : [items];
    if (!list.length) return;

    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { webhookUrl: true },
    });
    if (!client?.webhookUrl) return;

    const format = type.startsWith('event.') ? formatEventForWebhook : formatParticipantForWebhook;
    const timestamp = new Date().toISOString();
    await this.prisma.webhookDelivery.createMany({
      data: list.map((item) => ({
        clientId,
        webhookUrl: client.webhookUrl!,
        eventType: type,
        payload: { event: type, timestamp, clientId, data: { ...format(item), ...extra } },
      })),
    });
  }
}
