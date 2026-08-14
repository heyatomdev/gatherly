import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { BastionJwksService } from '../bastion-jwks.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

const ADMIN_ROLES = ['ADMIN', 'OWNER'];

@Injectable()
export class BastionUserGuard implements CanActivate {
  constructor(
    private readonly jwks: BastionJwksService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Token mancante');

    const payload = await this.jwks.verify(auth.slice(7));

    if (payload.type !== 'user') throw new UnauthorizedException('Non è un token utente');
    if (payload.appSlug !== 'gatherly') throw new ForbiddenException('App non autorizzata');
    if (!ADMIN_ROLES.includes(payload.role ?? '')) throw new ForbiddenException('Ruolo insufficiente');

    const client = await this.prisma.client.findUnique({ where: { tenantId: payload.tenantId } });
    if (!client || !client.isActive) throw new ForbiddenException('Client non attivo per il tenant');

    req.adminUser = payload;
    req.adminClient = client;
    return true;
  }
}
