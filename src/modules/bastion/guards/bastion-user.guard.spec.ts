import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BastionUserGuard } from './bastion-user.guard';
import { BastionJwksService } from '../bastion-jwks.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

const mockJwks = { verify: jest.fn() };
const mockPrisma = { client: { findUnique: jest.fn() } };
const mockConfig = {
  get: jest.fn((key: string) =>
    key === 'ADMIN_ACCEPTED_APP_SLUGS'
      ? 'gatherly,meridian'
      : key === 'ADMIN_ACCEPTED_ROLES'
        ? 'ADMIN,OWNER,SUPER_ADMIN'
        : undefined,
  ),
};

function makeCtx(headers: Record<string, string> = {}): ExecutionContext {
  const req = { headers, adminUser: undefined, adminClient: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

// Real Bastion user token: no `type` field (only machine tokens set type:'service_client').
const validPayload = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  email: 'admin@acme.com',
  appSlug: 'gatherly',
  role: 'ADMIN',
  iat: 0,
  exp: 9999999999,
};

const activeClient = { id: 'client-1', isActive: true, tenantId: 'tenant-1' };

describe('BastionUserGuard', () => {
  let guard: BastionUserGuard;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BastionUserGuard,
        { provide: BastionJwksService, useValue: mockJwks },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    guard = module.get(BastionUserGuard);
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
    mockPrisma.client.findUnique.mockResolvedValue(activeClient);
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 403 when role is MEMBER', async () => {
    mockJwks.verify.mockResolvedValue({ ...validPayload, role: 'MEMBER' });
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws 403 when role is missing', async () => {
    mockJwks.verify.mockResolvedValue({ ...validPayload, role: undefined });
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws 403 when client not found for tenantId', async () => {
    mockJwks.verify.mockResolvedValue(validPayload);
    mockPrisma.client.findUnique.mockResolvedValue(null);
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws 403 when client is inactive', async () => {
    mockJwks.verify.mockResolvedValue(validPayload);
    mockPrisma.client.findUnique.mockResolvedValue({ ...activeClient, isActive: false });
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('passes and populates req.adminUser + req.adminClient for ADMIN role', async () => {
    mockJwks.verify.mockResolvedValue(validPayload);
    mockPrisma.client.findUnique.mockResolvedValue(activeClient);
    const ctx = makeCtx({ authorization: 'Bearer tok' });
    const req = ctx.switchToHttp().getRequest();

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.adminUser).toEqual(validPayload);
    expect(req.adminClient).toEqual(activeClient);
  });

  it('passes for OWNER role', async () => {
    mockJwks.verify.mockResolvedValue({ ...validPayload, role: 'OWNER' });
    mockPrisma.client.findUnique.mockResolvedValue(activeClient);
    const ctx = makeCtx({ authorization: 'Bearer tok' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('passes for SUPER_ADMIN role', async () => {
    mockJwks.verify.mockResolvedValue({ ...validPayload, role: 'SUPER_ADMIN' });
    mockPrisma.client.findUnique.mockResolvedValue(activeClient);
    const ctx = makeCtx({ authorization: 'Bearer tok' });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('queries prisma with correct tenantId', async () => {
    mockJwks.verify.mockResolvedValue(validPayload);
    mockPrisma.client.findUnique.mockResolvedValue(activeClient);
    const ctx = makeCtx({ authorization: 'Bearer tok' });

    await guard.canActivate(ctx);

    expect(mockPrisma.client.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
  });
});
