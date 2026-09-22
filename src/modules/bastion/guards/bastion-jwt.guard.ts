import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { BastionJwksService } from '../bastion-jwks.service';
import { PrismaService } from '@/modules/prisma/prisma.service';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Guards the machine surface: everything that is not `@Public()` and not `/admin`
 * (which `BastionUserGuard` guards per-controller with a user token instead).
 *
 * A valid Bastion signature is not by itself an authorization here. Bastion signs
 * the whole fleet with one key, and both humans and machines get RS256 tokens from
 * it, so `jwks.verify()` succeeding only means "Bastion issued this to someone, for
 * something". The two checks below narrow that to "Bastion issued this to a machine,
 * for Gatherly".
 */
@Injectable()
export class BastionJwtGuard implements CanActivate {
  constructor(
    private readonly jwks: BastionJwksService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    if (req.path?.startsWith('/admin')) return true;
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Token mancante');

    const token = auth.slice(7);
    const payload = await this.jwks.verify(token);

    // Only machine tokens. Without this, any *user* token whose tenant has an active
    // Client authenticates the entire API — so anyone who can log into any app in
    // that Bastion tenant holds machine-level access to Gatherly.
    if (payload.type !== 'service_client') {
      throw new UnauthorizedException('Token non di tipo service_client');
    }

    // Only machine tokens minted for *this* service. One signing key for the fleet
    // means a client of `herald` or `articuno` verifies here unchanged, so an
    // over-scoped or compromised client of any other service would be a valid
    // Gatherly credential.
    const expectedSlug = this.config.get<string>('BASTION_APP_SLUG');
    if (payload.serviceSlug !== expectedSlug) {
      throw new UnauthorizedException('Token emesso per un altro servizio');
    }

    const client = await this.prisma.client.findUnique({
      where: { tenantId: payload.tenantId },
    });
    if (!client || !client.isActive) throw new UnauthorizedException('Client non autorizzato');

    req.user = payload;
    req.client = client;
    return true;
  }
}
