import { Inject, Injectable } from '@nestjs/common';
import {
  BASTION_OPTIONS,
  BastionAuditService,
  BastionJwksService,
  BastionModuleOptions,
  BastionUserGuard,
} from '@heyatom/bastion-client/nest';

/**
 * SUPER_ADMIN only, cross-tenant, no client lookup: the first client on an
 * empty DB could never be created otherwise. Same accepted apps as the
 * per-tenant guard, roles narrowed to one.
 */
@Injectable()
export class BastionSuperAdminGuard extends BastionUserGuard {
  constructor(
    jwks: BastionJwksService,
    audit: BastionAuditService,
    @Inject(BASTION_OPTIONS) options: BastionModuleOptions,
  ) {
    super(jwks, audit, { ...options, acceptedRoles: ['SUPER_ADMIN'] });
  }
}
