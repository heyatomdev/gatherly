import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

const TENANT_ADMIN_ROLES = ['ADMIN', 'OWNER', 'SUPER_ADMIN'];

/**
 * Narrows a route already behind BastionUserGuard (which accepts every
 * ADMIN_ACCEPTED_ROLES, incl. MODERATOR/AUTHOR) to tenant admins. Use at method
 * level: class guards run first, so req.adminUser is already set. Missing
 * adminUser = BastionUserGuard didn't run = deny.
 */
@Injectable()
export class TenantAdminRoleGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const role = ctx.switchToHttp().getRequest().adminUser?.role;
    if (!TENANT_ADMIN_ROLES.includes(role)) throw new ForbiddenException('Ruolo insufficiente');
    return true;
  }
}
