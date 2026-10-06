import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEventType, EventWebhookPayload, ParticipantWebhookPayload } from './dto/webhook-event.dto';

/** Rows claimed per queue tick — see `claimDue`. */
export const QUEUE_BATCH_SIZE = 50;

/**
 * How long a claimed row stays invisible to other replicas. Must comfortably
 * exceed the 10s HTTP timeout in `attempt()`.
 */
export const CLAIM_LEASE_MINUTES = 5;

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

  async enqueue(
    clientId: string,
    webhookUrl: string | null | undefined,
    payload: EventWebhookPayload | ParticipantWebhookPayload,
  ): Promise<void> {
    if (!webhookUrl) return;

    await this.prisma.webhookDelivery.create({
      data: {
        clientId,
        webhookUrl,
        eventType: payload.event,
        payload: payload as any,
      },
    });
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
          timeout: 10_000,
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
          lastError: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      if (failed) {
        this.logger.error(
          `Webhook permanently failed after ${attempts} attempts: ${delivery.webhookUrl}`,
        );
      }
    }
  }

  @Cron(CronExpression.EVERY_WEEK)
  async cleanupDeliveries(): Promise<void> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await this.prisma.webhookDelivery.deleteMany({
      where: { status: 'DELIVERED', updatedAt: { lt: cutoff } },
    });
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

  async notifyEventCreated(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any,
  ): Promise<void> {
    await this.enqueue(clientId, webhookUrl, {
      event: WebhookEventType.EVENT_CREATED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    });
  }

  async notifyEventUpdated(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any,
  ): Promise<void> {
    await this.enqueue(clientId, webhookUrl, {
      event: WebhookEventType.EVENT_UPDATED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    });
  }

  async notifyEventCancelled(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any,
  ): Promise<void> {
    await this.enqueue(clientId, webhookUrl, {
      event: WebhookEventType.EVENT_CANCELLED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    });
  }

  async notifyEventPublished(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any,
  ): Promise<void> {
    await this.enqueue(clientId, webhookUrl, {
      event: WebhookEventType.EVENT_PUBLISHED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    });
  }

  async notifyEventCompleted(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any,
  ): Promise<void> {
    await this.enqueue(clientId, webhookUrl, {
      event: WebhookEventType.EVENT_COMPLETED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    });
  }

  async notifyParticipantJoined(
    webhookUrl: string | null | undefined,
    clientId: string,
    participantData: any,
  ): Promise<void> {
    await this.enqueue(clientId, webhookUrl, {
      event: WebhookEventType.PARTICIPANT_JOINED,
      timestamp: new Date().toISOString(),
      clientId,
      data: participantData,
    });
  }

  async notifyParticipantStatusChanged(
    webhookUrl: string | null | undefined,
    clientId: string,
    participantData: any,
    previousStatus?: string,
  ): Promise<void> {
    await this.enqueue(clientId, webhookUrl, {
      event: WebhookEventType.PARTICIPANT_STATUS_CHANGED,
      timestamp: new Date().toISOString(),
      clientId,
      data: { ...participantData, previousStatus },
    });
  }

  async notifyParticipantRemoved(
    webhookUrl: string | null | undefined,
    clientId: string,
    participantData: any,
  ): Promise<void> {
    await this.enqueue(clientId, webhookUrl, {
      event: WebhookEventType.PARTICIPANT_REMOVED,
      timestamp: new Date().toISOString(),
      clientId,
      data: participantData,
    });
  }

  async notifyParticipantCheckedIn(
    webhookUrl: string | null | undefined,
    clientId: string,
    participantData: any,
  ): Promise<void> {
    await this.enqueue(clientId, webhookUrl, {
      event: WebhookEventType.PARTICIPANT_CHECKED_IN,
      timestamp: new Date().toISOString(),
      clientId,
      data: participantData,
    });
  }
}
