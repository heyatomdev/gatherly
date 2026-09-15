import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BastionService } from './bastion.service';
import { BastionJwksService } from './bastion-jwks.service';
import { BastionAuditService } from './bastion-audit.service';
import { BastionJwtGuard } from './guards/bastion-jwt.guard';
import { BastionUserGuard } from './guards/bastion-user.guard';
import { BastionSuperAdminGuard } from './guards/bastion-super-admin.guard';

@Module({
  imports: [ConfigModule],
  providers: [
    BastionService,
    BastionJwksService,
    BastionAuditService,
    BastionJwtGuard,
    BastionUserGuard,
    BastionSuperAdminGuard,
  ],
  exports: [
    BastionService,
    BastionJwksService,
    BastionAuditService,
    BastionJwtGuard,
    BastionUserGuard,
    BastionSuperAdminGuard,
  ],
})
export class BastionModule {}
