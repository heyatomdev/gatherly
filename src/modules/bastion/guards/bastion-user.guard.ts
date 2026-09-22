import { ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  BASTION_OPTIONS,
  BastionAuditService,
  BastionJwksService,
  BastionModuleOptions,
  BastionUserGuard as PackageUserGuard,
  UserJwtPayload,
} from '@heyatom/bastion-client/nest';
import { PrismaService } from '@/modules/prisma/prisma.service';

/**
 * Per-tenant admin guard: the package checks the user token (accepted apps and
 * roles come from `BastionModule` options, i.e. `ADMIN_ACCEPTED_*`); Gatherly adds
 * the binding to the tenant's local `Client`, exposed as `req.adminClient`.
 */
@Injectable()
export class BastionUserGuard extends PackageUserGuard {
  constructor(
    jwks: BastionJwksService,
    audit: BastionAuditService,
    @Inject(BASTION_OPTIONS) options: BastionModuleOptions,
    private readonly prisma: PrismaService,
  ) {
    super(jwks, audit, options);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    await super.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest();
    const user = req.adminUser as UserJwtPayload;
    const client = await this.prisma.client.findUnique({ where: { tenantId: user.tenantId } });
    if (!client || !client.isActive) throw new ForbiddenException('Client non attivo per il tenant');
    req.adminClient = client;
    return true;
  }
}
