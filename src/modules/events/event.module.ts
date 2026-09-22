import { Module } from '@nestjs/common';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { WebhookModule } from '../webhook/webhook.module';

import { IdempotencyInterceptor } from '@/common/idempotency.interceptor';

@Module({
  imports: [WebhookModule],
  controllers: [EventController],
  providers: [EventService, IdempotencyInterceptor],
  exports: [EventService],
})
export class EventModule {}
