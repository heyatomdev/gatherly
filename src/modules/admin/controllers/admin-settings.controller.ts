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
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { ClientService } from '@/modules/clients/client.service';

export class UpdateSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
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
  constructor(private readonly clients: ClientService) {}

  @Get()
  getSettings(@Request() req) {
    return req.adminClient;
  }

  @Patch()
  updateSettings(@Request() req, @Body() dto: UpdateSettingsDto) {
    return this.clients.updateClient(req.adminClient.id, dto);
  }

  @Post('webhook-secret')
  @HttpCode(HttpStatus.OK)
  regenerateWebhookSecret(@Request() req) {
    return this.clients.regenerateWebhookSecret(req.adminClient.id);
  }
}
