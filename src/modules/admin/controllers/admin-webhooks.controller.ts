import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { ClientService } from '@/modules/clients/client.service';

@ApiTags('admin/webhooks')
@ApiBearerAuth()
@Controller('admin/webhooks')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminWebhooksController {
  constructor(private readonly clients: ClientService) {}

  @Get('deliveries')
  deliveries(@Request() req, @Query('status') status?: string) {
    return this.clients.getWebhookDeliveries(req.adminClient.id, status);
  }
}
