import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TenantAdminRoleGuard } from './tenant-admin-role.guard';

function makeCtx(adminUser?: { role?: string }): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ adminUser }) }) } as unknown as ExecutionContext;
}

describe('TenantAdminRoleGuard', () => {
  const guard = new TenantAdminRoleGuard();

  it.each(['ADMIN', 'OWNER', 'SUPER_ADMIN'])('passes for %s', (role) => {
    expect(guard.canActivate(makeCtx({ role }))).toBe(true);
  });

  it.each(['MODERATOR', 'AUTHOR', 'MEMBER', undefined])('throws 403 for role %s', (role) => {
    expect(() => guard.canActivate(makeCtx({ role }))).toThrow(ForbiddenException);
  });

  it('throws 403 when adminUser is missing (BastionUserGuard not applied)', () => {
    expect(() => guard.canActivate(makeCtx())).toThrow(ForbiddenException);
  });
});
