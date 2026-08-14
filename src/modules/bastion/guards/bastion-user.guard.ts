import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BastionJwksService } from '../bastion-jwks.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

const ADMIN_ROLES = ['ADMIN', 'OWNER'];

@Injectable()
export class BastionUserGuard implements CanActivate {
  private readonly acceptedAppSlugs: string[];

  constructor(
    private readonly jwks: BastionJwksService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.acceptedAppSlugs = (this.config.get<string>('ADMIN_ACCEPTED_APP_SLUGS') ?? 'gatherly')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Token mancante');

    const payload = await this.jwks.verify(auth.slice(7));

    // Bastion user JWTs carry no `type` field — only machine tokens set `type: 'service_client'`.
    // Reject machine tokens; everything else is a user token.
    if (payload.type === 'service_client') {
      throw new UnauthorizedException('Token macchina non ammesso');
    }
    // The console (e.g. `meridian`) forwards its own user-JWT; its appSlug is not `gatherly`.
    // Accept any allowlisted app since app-bound refresh tokens cannot be exchanged cross-app.
    if (!this.acceptedAppSlugs.includes(payload.appSlug)) {
      throw new ForbiddenException('App non autorizzata');
    }
    if (!ADMIN_ROLES.includes(payload.role ?? '')) {
      throw new ForbiddenException('Ruolo insufficiente');
    }

    const client = await this.prisma.client.findUnique({ where: { tenantId: payload.tenantId } });
    if (!client || !client.isActive) throw new ForbiddenException('Client non attivo per il tenant');

    req.adminUser = payload;
    req.adminClient = client;
    return true;
  }
}
