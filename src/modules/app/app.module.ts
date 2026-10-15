import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from '@/modules/prisma/prisma.module';
import { ClientModule } from '@/modules/clients/client.module';
import { EventModule } from '@/modules/events/event.module';
import { CategoryModule } from '@/modules/categories/category.module';
import { TagModule } from '@/modules/tags/tag.module';
import { HealthModule } from '@/modules/health/health.module';
import { MetricsModule } from '@heyatom/nest-common/metrics';

import { BastionJwtGuard } from '@/modules/bastion/guards/bastion-jwt.guard';
import { BastionModule } from '@heyatom/bastion-client/nest';

/** Comma-separated env list → array; undefined keeps the package default. */
const splitList = (raw?: string): string[] | undefined =>
  raw === undefined
    ? undefined
    : raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
import { AdminModule } from '@/modules/admin/admin.module';
import { validate } from '@/configs/config.validation';
import { loggerConfig } from '@/configs/logger.config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import {
  AllExceptionsFilter,
  TransformInterceptor,
} from '@heyatom/nest-common';

@Module({
  controllers: [],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: '.env',
      expandVariables: false,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('THROTTLE_TTL_MS'),
          limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
        },
      ],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: loggerConfig,
    }),
    // Scheduling for jobs
    ScheduleModule.forRoot(),
    // Core modules
    PrismaModule,
    BastionModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseUrl: config.getOrThrow<string>('BASTION_URL'),
        serviceSlug: config.getOrThrow<string>('BASTION_APP_SLUG'),
        apiKey: config.get<string>('BASTION_CLIENT_API_KEY'),
        tenantSlug: config.get<string>('BASTION_TENANT_SLUG'),
        jwksTtlMs: config.get<number>('BASTION_JWKS_TTL_MS'),
        acceptedAppSlugs: splitList(
          config.get<string>('ADMIN_ACCEPTED_APP_SLUGS'),
        ),
        acceptedRoles: splitList(config.get<string>('ADMIN_ACCEPTED_ROLES')),
      }),
    }),
    HealthModule,
    // Own server on METRICS_PORT; applies MetricsMiddleware to every route itself
    // (a middleware, not an interceptor, so guard 401s and throttler 429s are counted).
    MetricsModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        app: 'gatherly',
        port: config.getOrThrow<number>('METRICS_PORT'),
      }),
    }),
    ClientModule,
    EventModule,
    CategoryModule,
    TagModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: BastionJwtGuard },
    // `{ data }` envelope; paginate() results pass through as `{ data, meta }`.
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // api.md §3 error body: { statusCode, code, message, errors?, requestId }; Prisma P2002/P2003 → 409, P2025 → 404.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
