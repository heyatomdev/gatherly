import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  Min,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';
import { swaggerEnabled } from '@heyatom/nest-common';

enum LogLevel {
  Trace = 'trace',
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
  Fatal = 'fatal',
}

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsOptional()
  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  @IsNumber()
  PORT: number = 3000;

  // Swagger UI on /docs. Unset → on only when NODE_ENV is explicitly development/test
  // (resolved in validate(), so an unset NODE_ENV fails closed).
  @IsOptional()
  @IsIn(['true', 'false'])
  ENABLE_SWAGGER?: string;

  @IsString()
  DATABASE_URL!: string;

  // pg pool behind the Prisma adapter (see PrismaService).
  @IsOptional()
  @IsNumber()
  DATABASE_POOL_MAX: number = 10;

  @IsOptional()
  @IsNumber()
  DATABASE_CONNECTION_TIMEOUT_MS: number = 5_000;

  @IsOptional()
  @IsNumber()
  DATABASE_STATEMENT_TIMEOUT_MS: number = 30_000;

  // Prometheus /metrics listener — internal network only, never published or proxied.
  @IsOptional()
  @IsNumber()
  METRICS_PORT: number = 9091;

  @IsOptional()
  @IsString()
  CORS_ORIGINS: string = 'http://localhost:3000';

  // X-Forwarded-For hops to trust for req.ip (the throttler keys on it): 0 = socket peer,
  // 1 = behind one nginx. Without it every client behind the proxy shares one IP.
  @IsOptional()
  @IsInt()
  @Min(0)
  TRUST_PROXY_HOPS: number = 0;

  @IsOptional()
  @IsNumber()
  THROTTLE_TTL_MS: number = 60_000;

  @IsOptional()
  @IsNumber()
  THROTTLE_LIMIT: number = 100;

  @IsString()
  BASTION_URL!: string;

  @IsString()
  BASTION_APP_SLUG!: string;

  @IsOptional()
  @IsString()
  BASTION_TENANT_SLUG?: string;

  @IsString()
  BASTION_CLIENT_API_KEY!: string;

  @IsOptional()
  @IsNumber()
  BASTION_JWKS_TTL_MS: number = 300_000;

  // Comma-separated appSlug allowlist accepted by the admin API (Bastion user-JWT).
  // Includes the central console app (e.g. `meridian`) since refresh tokens are app-bound
  // and cannot be exchanged across apps.
  @IsOptional()
  @IsString()
  ADMIN_ACCEPTED_APP_SLUGS: string = 'gatherly';

  // Comma-separated Bastion roles allowed on the admin API. This list must include
  // every Meridian console role (currently SUPER_ADMIN, ADMIN, MODERATOR, AUTHOR;
  // OWNER kept for local admins) — adding a role in Bastion requires adding it here too.
  // Fine-grained permissions are enforced by Meridian's BFF, not here.
  @IsOptional()
  @IsString()
  ADMIN_ACCEPTED_ROLES: string = 'ADMIN,OWNER,SUPER_ADMIN,MODERATOR,AUTHOR';

  @IsOptional()
  @IsNumber()
  VIP_THRESHOLD: number = 5;

  @IsOptional()
  @IsNumber()
  AT_RISK_DAYS: number = 120;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('; ');
    throw new Error(`Config validation failed — ${messages}`);
  }

  // From the raw env, not the class default: NODE_ENV defaults to development above.
  validatedConfig.ENABLE_SWAGGER = String(
    swaggerEnabled({
      ENABLE_SWAGGER: validatedConfig.ENABLE_SWAGGER,
      NODE_ENV: config.NODE_ENV as string | undefined,
    }),
  );

  return validatedConfig;
}
