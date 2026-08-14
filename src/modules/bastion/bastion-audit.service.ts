import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BastionService } from './bastion.service';

@Injectable()
export class BastionAuditService implements OnModuleInit {
  private readonly logger = new Logger(BastionAuditService.name);
  private token: string | null = null;
  private expiresAt = 0;

  constructor(private readonly bastion: BastionService) {}

  async onModuleInit() {
    try {
      await this.ensureToken();
    } catch (err: any) {
      this.logger.warn('Initial Bastion service-client token fetch failed', err?.message);
    }
  }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 5 * 60 * 1000) {
      return this.token;
    }
    const { accessToken } = await this.bastion.clientAuth();
    this.token = accessToken;
    this.expiresAt = Date.now() + 60 * 60 * 1000;
    this.logger.log('Service-client token refreshed');
    return this.token;
  }

  async write(
    event: string,
    opts: { userId?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    try {
      const token = await this.ensureToken();
      await this.bastion.writeAuditEvent(token, { event, ...opts });
    } catch (err: any) {
      this.logger.error(`Audit write failed event=${event}`, err?.message);
    }
  }
}
