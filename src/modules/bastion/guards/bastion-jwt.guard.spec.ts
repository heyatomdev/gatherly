import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { BastionJwtGuard } from './bastion-jwt.guard';
import { BastionJwksService } from '../bastion-jwks.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

const mockJwks = { verify: jest.fn() };
const mockPrisma = { client: { findUnique: jest.fn() } };
const mockConfig = {
  get: jest.fn((key: string) => (key === 'BASTION_APP_SLUG' ? 'gatherly' : undefined)),
};
const mockReflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };

function makeCtx(headers: Record<string, string> = {}, path = '/events'): ExecutionContext {
  const req = { headers, path, user: undefined, client: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

/** A machine token: `type: 'service_client'`, `serviceSlug`, and no `appSlug`. */
const machineToken = {
  sub: 'client-1',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  type: 'service_client',
  serviceSlug: 'gatherly',
  iat: 0,
  exp: 9999999999,
};

/** A human token: no `type`, and an `appSlug` instead of a `serviceSlug`. */
const userToken = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  tenantSlug: 'acme',
  appSlug: 'gatherly',
  role: 'ADMIN',
  iat: 0,
  exp: 9999999999,
};

const activeClient = { id: 'client-1', isActive: true, tenantId: 'tenant-1' };

describe('BastionJwtGuard', () => {
  let guard: BastionJwtGuard;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BastionJwtGuard,
        { provide: BastionJwksService, useValue: mockJwks },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get(BastionJwtGuard);
    jest.clearAllMocks();
    mockReflector.getAllAndOverride.mockReturnValue(false);
  });

  it('accepts a machine token minted for this service', async () => {
    mockJwks.verify.mockResolvedValue(machineToken);
    mockPrisma.client.findUnique.mockResolvedValue(activeClient);

    await expect(guard.canActivate(makeCtx({ authorization: 'Bearer tok' }))).resolves.toBe(true);
  });

  // The hole this guard had: `jwks.verify()` succeeding only proves Bastion issued
  // the token to someone. A human token whose tenant has an active Client would
  // otherwise authenticate the whole machine API.
  it('rejects a user token even when the tenant has an active client', async () => {
    mockJwks.verify.mockResolvedValue(userToken);
    mockPrisma.client.findUnique.mockResolvedValue(activeClient);

    await expect(guard.canActivate(makeCtx({ authorization: 'Bearer tok' }))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockPrisma.client.findUnique).not.toHaveBeenCalled();
  });

  // Bastion signs the whole fleet with one key, so another service's machine token
  // verifies here too. It must not authenticate.
  it('rejects a machine token minted for another service', async () => {
    mockJwks.verify.mockResolvedValue({ ...machineToken, serviceSlug: 'herald' });
    mockPrisma.client.findUnique.mockResolvedValue(activeClient);

    await expect(guard.canActivate(makeCtx({ authorization: 'Bearer tok' }))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(mockPrisma.client.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a machine token with no serviceSlug at all', async () => {
    const { serviceSlug, ...noSlug } = machineToken;
    mockJwks.verify.mockResolvedValue(noSlug);

    await expect(guard.canActivate(makeCtx({ authorization: 'Bearer tok' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects when the tenant has no active client', async () => {
    mockJwks.verify.mockResolvedValue(machineToken);
    mockPrisma.client.findUnique.mockResolvedValue({ ...activeClient, isActive: false });

    await expect(guard.canActivate(makeCtx({ authorization: 'Bearer tok' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with no Bearer token', async () => {
    await expect(guard.canActivate(makeCtx())).rejects.toThrow(UnauthorizedException);
  });

  it('lets @Public() routes through without a token', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(makeCtx())).resolves.toBe(true);
    expect(mockJwks.verify).not.toHaveBeenCalled();
  });

  // Not a hole: /admin is guarded per-controller by BastionUserGuard, which takes a
  // user token. This guard steps aside rather than demanding a machine token there.
  it('steps aside on /admin, which BastionUserGuard owns', async () => {
    await expect(guard.canActivate(makeCtx({}, '/admin/events'))).resolves.toBe(true);
    expect(mockJwks.verify).not.toHaveBeenCalled();
  });
});
