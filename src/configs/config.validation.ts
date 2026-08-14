import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, validateSync } from 'class-validator';

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
  PORT: number = 3001;

  @IsString()
  DATABASE_URL!: string;

  @IsOptional()
  @IsString()
  CORS_ORIGINS: string = 'http://localhost:3000';

  @IsOptional()
  @IsString()
  APP_BASE_URL?: string;

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
  BASTION_JWKS_TTL_MS: number = 3_600_000;

  // Comma-separated appSlug allowlist accepted by the admin API (Bastion user-JWT).
  // Includes the central console app (e.g. `meridian`) since refresh tokens are app-bound
  // and cannot be exchanged across apps.
  @IsOptional()
  @IsString()
  ADMIN_ACCEPTED_APP_SLUGS: string = 'gatherly';

  // Comma-separated Bastion roles allowed on the admin API. Aligned with the
  // console login check (ADMIN | SUPER_ADMIN); OWNER kept for local admins.
  @IsOptional()
  @IsString()
  ADMIN_ACCEPTED_ROLES: string = 'ADMIN,OWNER,SUPER_ADMIN';
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
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Config validation failed — ${messages}`);
  }

  return validatedConfig;
}
