import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  providers: [WebhookService],
  exports: [WebhookService],
  imports: [HttpModule]
})
export class WebhookModule {}
