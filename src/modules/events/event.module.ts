import { Module } from '@nestjs/common';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { WebhookModule } from '../webhook/webhook.module';
import { BastionModule } from '../bastion/bastion.module';
import { IdempotencyInterceptor } from '@/common/idempotency.interceptor';

@Module({
  imports: [WebhookModule, BastionModule],
  controllers: [EventController],
  providers: [EventService, IdempotencyInterceptor],
  exports: [EventService],
})
export class EventModule {}
