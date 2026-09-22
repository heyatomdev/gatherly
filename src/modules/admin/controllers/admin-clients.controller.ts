import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BastionSuperAdminGuard } from '@/modules/bastion/guards/bastion-super-admin.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { BastionAuditService } from '@heyatom/bastion-client/nest';
import { ClientService } from '@/modules/clients/client.service';
import { CreateClientDto, UpdateClientDto } from '@/modules/clients/dto/client.dto';

/**
 * Client management — SUPER_ADMIN only.
 *
 * ⚠️ The global BastionJwtGuard returns `true` for every path starting with
 * `/admin` (it defers auth to per-controller guards for the admin surface).
 * A controller here WITHOUT its own `@UseGuards(...)` is therefore fully
 * public — `BastionSuperAdminGuard` on the class is mandatory, not optional.
 */
@ApiTags('admin/clients')
@ApiBearerAuth()
@Controller('admin/clients')
@UseGuards(BastionSuperAdminGuard, AdminThrottlerGuard)
export class AdminClientsController {
  constructor(
    private readonly clients: ClientService,
    private readonly audit: BastionAuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all clients (token and webhookSecret excluded)' })
  list() {
    return this.clients.getAllClients();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create client — returns token once' })
  async create(@Request() req, @Body() dto: CreateClientDto) {
    const client = await this.clients.createClient(dto);
    this.audit.write('admin.client.created', {
      userId: req.adminUser?.sub,
      metadata: { clientId: client.id, tenantId: client.tenantId },
    });
    return client;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update client settings' })
  async update(@Request() req, @Param('id') id: string, @Body() dto: UpdateClientDto) {
    const client = await this.clients.updateClient(id, dto);
    this.audit.write('admin.client.updated', {
      userId: req.adminUser?.sub,
      metadata: { clientId: id, tenantId: client.tenantId },
    });
    return client;
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke client — blocks all API access' })
  async revoke(@Request() req, @Param('id') id: string) {
    const client = await this.clients.revokeClient(id);
    this.audit.write('admin.client.revoked', {
      userId: req.adminUser?.sub,
      metadata: { clientId: id, tenantId: client.tenantId },
    });
    return client;
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a revoked client' })
  async reactivate(@Request() req, @Param('id') id: string) {
    const client = await this.clients.reactivateClient(id);
    this.audit.write('admin.client.reactivated', {
      userId: req.adminUser?.sub,
      metadata: { clientId: id, tenantId: client.tenantId },
    });
    return client;
  }

  @Post(':id/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate client API token' })
  async regenerateToken(@Request() req, @Param('id') id: string) {
    const result = await this.clients.regenerateToken(id);
    // Never log the token itself.
    this.audit.write('admin.client.token_regenerated', {
      userId: req.adminUser?.sub,
      metadata: { clientId: id },
    });
    return result;
  }

  @Post(':id/webhook-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate webhook HMAC secret — use to verify X-Webhook-Signature header' })
  async regenerateWebhookSecret(@Request() req, @Param('id') id: string) {
    const result = await this.clients.regenerateWebhookSecret(id);
    // Never log the secret itself.
    this.audit.write('admin.client.webhook_secret_regenerated', {
      userId: req.adminUser?.sub,
      metadata: { clientId: id },
    });
    return result;
  }

  @Get(':id/webhook-deliveries')
  @ApiOperation({ summary: 'List webhook delivery attempts for debugging' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'DELIVERED', 'FAILED'] })
  getWebhookDeliveries(@Param('id') id: string, @Query('status') status?: string) {
    return this.clients.getWebhookDeliveries(id, status);
  }
}
