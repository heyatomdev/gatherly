import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

const CLIENT_SELECT_SAFE = {
  id: true,
  name: true,
  isActive: true,
  defaultLocale: true,
  emailActive: true,
  webhookUrl: true,
  createdAt: true,
  revokedAt: true,
} as const;

@Injectable()
export class ClientService {
  constructor(private prisma: PrismaService) {}

  async createClient(dto: CreateClientDto) {
    return this.prisma.client.create({
      data: {
        name: dto.name,
        token: this.generateToken(),
        defaultLocale: dto.defaultLocale ?? 'it',
        emailActive: dto.emailActive ?? false,
        webhookUrl: dto.webhookUrl,
        webhookSecret: randomBytes(32).toString('hex'),
      },
      select: { ...CLIENT_SELECT_SAFE, token: true },
    });
  }

  async getAllClients() {
    return this.prisma.client.findMany({
      select: CLIENT_SELECT_SAFE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateClient(id: string, dto: UpdateClientDto) {
    await this.findOrFail(id);
    return this.prisma.client.update({
      where: { id },
      data: dto,
      select: CLIENT_SELECT_SAFE,
    });
  }

  async revokeClient(id: string) {
    await this.findOrFail(id);
    return this.prisma.client.update({
      where: { id },
      data: { isActive: false, revokedAt: new Date() },
      select: CLIENT_SELECT_SAFE,
    });
  }

  async regenerateToken(id: string) {
    await this.findOrFail(id);
    return this.prisma.client.update({
      where: { id },
      data: { token: this.generateToken() },
      select: { id: true, name: true, token: true },
    });
  }

  async regenerateWebhookSecret(id: string) {
    await this.findOrFail(id);
    return this.prisma.client.update({
      where: { id },
      data: { webhookSecret: randomBytes(32).toString('hex') },
      select: { id: true, webhookSecret: true },
    });
  }

  async getWebhookDeliveries(id: string, status?: string) {
    await this.findOrFail(id);
    return this.prisma.webhookDelivery.findMany({
      where: {
        clientId: id,
        ...(status && { status: status as any }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getClientByToken(token: string) {
    return this.prisma.client.findUnique({ where: { token } });
  }

  private async findOrFail(id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException(`Client ${id} not found`);
    return client;
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }
}
