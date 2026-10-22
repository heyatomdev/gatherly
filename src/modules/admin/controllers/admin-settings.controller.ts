import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiPropertyOptional,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { TenantAdminRoleGuard } from '@/modules/bastion/guards/tenant-admin-role.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { BastionAuditService } from '@heyatom/bastion-client/nest';
import { ClientService } from '@/modules/clients/client.service';
import {
  ClientResponseDto,
  WebhookSecretResponseDto,
} from '@/modules/clients/dto/client-response.dto';

export class UpdateSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  webhookUrl?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultLocale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailActive?: boolean;
}

@ApiTags('admin/settings')
@ApiBearerAuth()
@Controller('admin/settings')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminSettingsController {
  constructor(
    private readonly clients: ClientService,
    private readonly audit: BastionAuditService,
  ) {}

  @Get()
  @ApiOkResponse({ type: ClientResponseDto })
  getSettings(@Request() req) {
    // Never return req.adminClient as-is: it carries token + webhookSecret.
    return this.clients.getClient(req.adminClient.id);
  }

  @Patch()
  @ApiOkResponse({ type: ClientResponseDto })
  @UseGuards(TenantAdminRoleGuard)
  async updateSettings(@Request() req, @Body() dto: UpdateSettingsDto) {
    const client = await this.clients.updateClient(req.adminClient.id, dto);
    // webhookUrl decides where tenant data is POSTed — the audit trail must show who moved it.
    this.audit.writeAsAdmin('settings.updated', req.adminUser, {
      clientId: req.adminClient.id,
      fields: Object.keys(dto),
      ...(dto.webhookUrl !== undefined && {
        webhookUrlChanged: dto.webhookUrl !== req.adminClient.webhookUrl,
      }),
    });
    return client;
  }

  @Post('webhook-secret')
  @ApiOkResponse({ type: WebhookSecretResponseDto })
  @UseGuards(TenantAdminRoleGuard)
  @HttpCode(HttpStatus.OK)
  async regenerateWebhookSecret(@Request() req) {
    const result = await this.clients.regenerateWebhookSecret(
      req.adminClient.id,
    );
    // Never log the secret itself.
    this.audit.writeAsAdmin(
      'settings.webhook_secret_regenerated',
      req.adminUser,
      { clientId: req.adminClient.id },
    );
    return result;
  }
}
