import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { BastionSuperAdminGuard } from '@/modules/bastion/guards/bastion-super-admin.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';

/**
 * The global BastionJwtGuard waves every /admin path through, so an admin
 * controller without its own class-level guard is fully public. This scans
 * every *.controller.ts under src/ (registered in a module or not) and fails
 * on any controller mounted under /admin that doesn't gate itself.
 */
function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

const adminControllers = controllerFiles(join(__dirname, '..', '..')).flatMap((file) =>
  Object.values(require(file) as Record<string, unknown>)
    .filter((exp): exp is Function => typeof exp === 'function')
    .filter((cls) => {
      const paths = [Reflect.getMetadata(PATH_METADATA, cls)].flat();
      return paths.some((p) => typeof p === 'string' && /^\/?admin(\/|$)/.test(p));
    })
    .map((cls) => [cls.name, cls] as const),
);

describe('admin controllers', () => {
  it('finds the admin controllers (sanity check on the scan)', () => {
    expect(adminControllers.length).toBeGreaterThanOrEqual(9);
  });

  it.each(adminControllers)('%s has a class-level auth guard and AdminThrottlerGuard', (_, cls) => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
    const authGuards = guards.filter((g) => g === BastionUserGuard || g === BastionSuperAdminGuard);
    expect(authGuards).toHaveLength(1);
    expect(guards).toContain(AdminThrottlerGuard);
  });
});
