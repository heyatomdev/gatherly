import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { RemoteJWKSetOptions } from 'jose';
import { JwtPayload } from './bastion.types';

@Injectable()
export class BastionJwksService {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly config: ConfigService) {}

  private getJwks(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      const url = `${this.config.get<string>('BASTION_URL')}/.well-known/jwks.json`;
      const ttlMs = this.config.get<number>('BASTION_JWKS_TTL_MS') ?? 3_600_000;
      const options: RemoteJWKSetOptions = { cacheMaxAge: ttlMs };
      this.jwks = createRemoteJWKSet(new URL(url), options);
    }
    return this.jwks;
  }

  async verify(token: string): Promise<JwtPayload> {
    try {
      const { payload } = await jwtVerify(token, this.getJwks(), {
        algorithms: ['RS256'],
      });
      return payload as unknown as JwtPayload;
    } catch {
      throw new UnauthorizedException('Token non valido');
    }
  }
}
