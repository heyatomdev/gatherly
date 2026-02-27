import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-client-token'];

    if (!token) {
      throw new UnauthorizedException('Token mancante');
    }

    const client = await this.prisma.client.findUnique({
      where: { token },
    });

    if (!client) {
      throw new UnauthorizedException('Token non valido');
    }

    request.client = client;
    return true;
  }
}

