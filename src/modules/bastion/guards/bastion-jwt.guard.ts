import { ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  BASTION_OPTIONS,
  BastionJwksService,
  BastionModuleOptions,
  ServiceClientJwtGuard,
  ServiceClientJwtPayload,
} from '@heyatom/bastion-client/nest';
import { PrismaService } from '@/modules/prisma/prisma.service';

/**
 * Guards the machine surface: everything that is not `@Public()` and not `/admin`
 * (which `BastionUserGuard` guards per-controller with a user token instead).
 *
 * The package guard does the Bastion part — signature, `type: service_client`,
 * `serviceSlug === BASTION_APP_SLUG`, `@RequireScope`. What is Gatherly's alone
 * is the binding to a local `Client` row: the token's tenant must have an active
 * client here, and that row rides on `req.client` for the handlers.
 */
/** `/admin` and `/admin/...` only — a bare prefix match would also wave through `/administrators`. */
function isAdminPath(path: string | undefined): boolean {
  return path === '/admin' || Boolean(path?.startsWith('/admin/'));
}

@Injectable()
export class BastionJwtGuard extends ServiceClientJwtGuard {
  constructor(
    jwks: BastionJwksService,
    reflector: Reflector,
    @Inject(BASTION_OPTIONS) options: BastionModuleOptions,
    private readonly prisma: PrismaService,
  ) {
    super(jwks, reflector, options);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if (isAdminPath(req.path)) return true;

    await super.canActivate(ctx);
    if (!req.user) return true; // @Public() — the package guard stepped aside

    const payload = req.user as ServiceClientJwtPayload;
    const client = await this.prisma.client.findUnique({ where: { tenantId: payload.tenantId } });
    if (!client || !client.isActive) throw new UnauthorizedException('Client non autorizzato');
    req.client = client;
    return true;
  }
}
