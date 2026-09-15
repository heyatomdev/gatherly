import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BastionSuperAdminGuard } from './bastion-super-admin.guard';
import { BastionJwksService } from '../bastion-jwks.service';

const mockJwks = { verify: jest.fn() };
const mockConfig = {
  get: jest.fn((key: string) => (key === 'ADMIN_ACCEPTED_APP_SLUGS' ? 'gatherly,meridian' : undefined)),
};

function makeCtx(headers: Record<string, string> = {}): ExecutionContext {
  const req = { headers, adminUser: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

// Real Bastion user token: no `type` field (only machine tokens set type:'service_client').
const validPayload = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  email: 'super@acme.com',
  appSlug: 'gatherly',
  role: 'SUPER_ADMIN',
  iat: 0,
  exp: 9999999999,
};

describe('BastionSuperAdminGuard', () => {
  let guard: BastionSuperAdminGuard;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BastionSuperAdminGuard,
        { provide: BastionJwksService, useValue: mockJwks },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    guard = module.get(BastionSuperAdminGuard);
    jest.clearAllMocks();
  });

  it('throws 401 when Authorization header missing', async () => {
    const ctx = makeCtx();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when Authorization header is not Bearer', async () => {
    const ctx = makeCtx({ authorization: 'Basic abc' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 401 when token is a machine token (type "service_client")', async () => {
    mockJwks.verify.mockResolvedValue({ ...validPayload, type: 'service_client' });
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('throws 403 when appSlug is not in the allowlist', async () => {
    mockJwks.verify.mockResolvedValue({ ...validPayload, appSlug: 'other-app' });
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('accepts an allowlisted console app (appSlug "meridian")', async () => {
    mockJwks.verify.mockResolvedValue({ ...validPayload, appSlug: 'meridian' });
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 403 when role is ADMIN (not SUPER_ADMIN)', async () => {
    mockJwks.verify.mockResolvedValue({ ...validPayload, role: 'ADMIN' });
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws 403 when role is missing', async () => {
    mockJwks.verify.mockResolvedValue({ ...validPayload, role: undefined });
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('passes and populates req.adminUser for SUPER_ADMIN role', async () => {
    mockJwks.verify.mockResolvedValue(validPayload);
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    const req = ctx.switchToHttp().getRequest();

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.adminUser).toEqual(validPayload);
  });

  it('never queries prisma (no client/tenant lookup)', async () => {
    // BastionSuperAdminGuard must not depend on PrismaService at all — a
    // SUPER_ADMIN manages clients across tenants, and the very first client
    // on an empty DB could never be created if a lookup were required.
    expect((guard as any).prisma).toBeUndefined();
    mockJwks.verify.mockResolvedValue(validPayload);
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
