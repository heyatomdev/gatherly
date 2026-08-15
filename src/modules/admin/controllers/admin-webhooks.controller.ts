import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { ClientService } from '@/modules/clients/client.service';
import { WebhookService } from '@/modules/webhook/webhook.service';

@ApiTags('admin/webhooks')
@ApiBearerAuth()
@Controller('admin/webhooks')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminWebhooksController {
  constructor(
    private readonly clients: ClientService,
    private readonly webhooks: WebhookService,
  ) {}

  @Get('deliveries')
  deliveries(@Request() req, @Query('status') status?: string) {
    return this.clients.getWebhookDeliveries(req.adminClient.id, status);
  }

  @Post('deliveries/:id/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  retry(@Request() req, @Param('id') id: string) {
    return this.webhooks.retryDelivery(id, req.adminClient.id);
  }
}
