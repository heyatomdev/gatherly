import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ClientService } from './client.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { Public } from '@/decorators/public.decorator';

@ApiTags('clients')
@Controller('clients')
export class ClientController {
  constructor(private clientService: ClientService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create client — returns token' })
  async createClient(@Body() dto: CreateClientDto) {
    return this.clientService.createClient(dto);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'List all clients (token excluded)' })
  async getAllClients() {
    return this.clientService.getAllClients();
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update client settings' })
  async updateClient(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientService.updateClient(id, dto);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke client — blocks all API access' })
  async revokeClient(@Param('id') id: string) {
    return this.clientService.revokeClient(id);
  }

  @Post(':id/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate client API token' })
  async regenerateToken(@Param('id') id: string) {
    return this.clientService.regenerateToken(id);
  }

  @Post(':id/webhook-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate webhook HMAC secret — use to verify X-Webhook-Signature header' })
  async regenerateWebhookSecret(@Param('id') id: string) {
    return this.clientService.regenerateWebhookSecret(id);
  }

  @Get(':id/webhook-deliveries')
  @ApiOperation({ summary: 'List webhook delivery attempts for debugging' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'DELIVERED', 'FAILED'] })
  async getWebhookDeliveries(@Param('id') id: string, @Query('status') status?: string) {
    return this.clientService.getWebhookDeliveries(id, status);
  }
}
