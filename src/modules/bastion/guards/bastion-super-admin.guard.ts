import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BastionJwksService } from '../bastion-jwks.service';

/**
 * Gate for routes that manage Client records themselves (e.g. /admin/clients).
 * Unlike BastionUserGuard, this guard does NOT look up a Client by the token's
 * tenantId: on an empty DB the very first client could never be created if we
 * required one to already exist, and a SUPER_ADMIN routinely manages clients
 * belonging to tenants other than their own. Authorization here is strictly
 * "is this a SUPER_ADMIN user token", nothing tenant-scoped.
 */
@Injectable()
export class BastionSuperAdminGuard implements CanActivate {
  private readonly acceptedAppSlugs: string[];

  constructor(
    private readonly jwks: BastionJwksService,
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
    if (payload.type === 'service_client') {
      throw new UnauthorizedException('Token macchina non ammesso');
    }
    if (!this.acceptedAppSlugs.includes(payload.appSlug)) {
      throw new ForbiddenException('App non autorizzata');
    }
    if (payload.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Ruolo insufficiente');
    }

    req.adminUser = payload;
    return true;
  }
}
