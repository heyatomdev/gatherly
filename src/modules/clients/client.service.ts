import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientService {
  constructor(private prisma: PrismaService) {}

  async createClient(name: string) {
    return this.prisma.client.create({
      data: {
        name,
        token: this.generateToken(),
      },
    });
  }

  async getClientByToken(token: string) {
    return this.prisma.client.findUnique({
      where: { token },
    });
  }

  async getAllClients() {
    return this.prisma.client.findMany();
  }

  private generateToken(): string {
    return Buffer.from(
      `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    ).toString('base64');
  }
}

