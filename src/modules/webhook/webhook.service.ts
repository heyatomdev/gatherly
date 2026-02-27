import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WebhookEventType, EventWebhookPayload, ParticipantWebhookPayload } from './dto/webhook-event.dto';

@Injectable()
export class WebhookService {

  constructor(private httpService: HttpService) {}

  private readonly logger = new Logger(WebhookService.name);

  /**
   * Sends a generic webhook notification to the client's webhook URL
   * @param webhookUrl The webhook URL from the client configuration
   * @param payload The webhook payload to send
   */
  private async sendWebhookNotification(
    webhookUrl: string | null | undefined,
    payload: EventWebhookPayload | ParticipantWebhookPayload
  ): Promise<void> {
    if (!webhookUrl) {
      this.logger.warn(`Webhook URL not configured for client ${payload.clientId}`);
      return;
    }

    try {
      await firstValueFrom(this.httpService.post(webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'EventPlan/1.0 Webhook',
        },
      }));
      this.logger.log(`Webhook notification sent for event: ${payload.event}, Client: ${payload.clientId}`);
    } catch (error) {
      this.logger.error(
        `Error sending webhook notification to ${webhookUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
      // Don't throw - webhook failures shouldn't break the main operation
    }
  }

  /**
   * Notifies when a new event is created
   */
  async notifyEventCreated(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any
  ): Promise<void> {
    const payload: EventWebhookPayload = {
      event: WebhookEventType.EVENT_CREATED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    };

    await this.sendWebhookNotification(webhookUrl, payload);
  }

  /**
   * Notifies when an event is updated
   */
  async notifyEventUpdated(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any
  ): Promise<void> {
    const payload: EventWebhookPayload = {
      event: WebhookEventType.EVENT_UPDATED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    };

    await this.sendWebhookNotification(webhookUrl, payload);
  }

  /**
   * Notifies when an event is cancelled
   */
  async notifyEventCancelled(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any
  ): Promise<void> {
    const payload: EventWebhookPayload = {
      event: WebhookEventType.EVENT_CANCELLED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    };

    await this.sendWebhookNotification(webhookUrl, payload);
  }

  /**
   * Notifies when an event is published
   */
  async notifyEventPublished(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any
  ): Promise<void> {
    const payload: EventWebhookPayload = {
      event: WebhookEventType.EVENT_PUBLISHED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    };

    await this.sendWebhookNotification(webhookUrl, payload);
  }

  /**
   * Notifies when an event is completed
   */
  async notifyEventCompleted(
    webhookUrl: string | null | undefined,
    clientId: string,
    eventData: any
  ): Promise<void> {
    const payload: EventWebhookPayload = {
      event: WebhookEventType.EVENT_COMPLETED,
      timestamp: new Date().toISOString(),
      clientId,
      data: eventData,
    };

    await this.sendWebhookNotification(webhookUrl, payload);
  }

  /**
   * Notifies when a new participant joins an event
   */
  async notifyParticipantJoined(
    webhookUrl: string | null | undefined,
    clientId: string,
    participantData: any
  ): Promise<void> {
    const payload: ParticipantWebhookPayload = {
      event: WebhookEventType.PARTICIPANT_JOINED,
      timestamp: new Date().toISOString(),
      clientId,
      data: participantData,
    };

    await this.sendWebhookNotification(webhookUrl, payload);
  }

  /**
   * Notifies when a participant's status changes
   */
  async notifyParticipantStatusChanged(
    webhookUrl: string | null | undefined,
    clientId: string,
    participantData: any,
    previousStatus?: string
  ): Promise<void> {
    const payload: ParticipantWebhookPayload = {
      event: WebhookEventType.PARTICIPANT_STATUS_CHANGED,
      timestamp: new Date().toISOString(),
      clientId,
      data: {
        ...participantData,
        previousStatus,
      },
    };

    await this.sendWebhookNotification(webhookUrl, payload);
  }

  /**
   * Notifies when a participant is removed from an event
   */
  async notifyParticipantRemoved(
    webhookUrl: string | null | undefined,
    clientId: string,
    participantData: any
  ): Promise<void> {
    const payload: ParticipantWebhookPayload = {
      event: WebhookEventType.PARTICIPANT_REMOVED,
      timestamp: new Date().toISOString(),
      clientId,
      data: participantData,
    };

    await this.sendWebhookNotification(webhookUrl, payload);
  }

  /**
   * Notifies when a participant checks in to an event
   */
  async notifyParticipantCheckedIn(
    webhookUrl: string | null | undefined,
    clientId: string,
    participantData: any
  ): Promise<void> {
    const payload: ParticipantWebhookPayload = {
      event: WebhookEventType.PARTICIPANT_CHECKED_IN,
      timestamp: new Date().toISOString(),
      clientId,
      data: participantData,
    };

    await this.sendWebhookNotification(webhookUrl, payload);
  }

}
