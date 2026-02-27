import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ClientService } from './client.service';

export class CreateClientDto {
  name: string;
}

@Controller('clients')
export class ClientController {
  constructor(private clientService: ClientService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createClient(@Body() data: CreateClientDto) {
    return this.clientService.createClient(data.name);
  }

  @Get()
  async getAllClients() {
    return this.clientService.getAllClients();
  }
}

