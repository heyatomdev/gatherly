import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { HttpModule } from '@nestjs/axios';
import { WebhookMetrics } from './webhook.metrics';

@Module({
  providers: [WebhookService, WebhookMetrics],
  exports: [WebhookService],
  imports: [HttpModule],
})
export class WebhookModule {}
