import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BastionJwksService } from '../bastion-jwks.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

export const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class BastionJwtGuard implements CanActivate {
  constructor(
    private readonly jwks: BastionJwksService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    if (req.path?.startsWith('/admin')) return true;
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Token mancante');

    const token = auth.slice(7);
    const payload = await this.jwks.verify(token);

    const client = await this.prisma.client.findUnique({
      where: { tenantId: payload.tenantId },
    });
    if (!client || !client.isActive) throw new UnauthorizedException('Client non autorizzato');

    req.user = payload;
    req.client = client;
    return true;
  }
}
