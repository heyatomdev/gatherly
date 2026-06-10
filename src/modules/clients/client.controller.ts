import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClientService } from './client.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

@ApiTags('clients')
@Controller('clients')
export class ClientController {
  constructor(private clientService: ClientService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create client — returns token' })
  async createClient(@Body() dto: CreateClientDto) {
    return this.clientService.createClient(dto);
  }

  @Get()
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
}
