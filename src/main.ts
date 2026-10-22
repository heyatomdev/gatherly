import 'dotenv/config';
import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import {
  parseCorsOrigins,
  setupHttpApp,
  setupSwagger,
} from '@heyatom/nest-common';
import { AppModule } from './modules/app/app.module';
import { SWAGGER_OPTIONS } from './common/openapi';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // Defaults live in config.validation.ts — single source of truth.
  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');

  // Shutdown hooks, trust proxy, helmet, CORS allowlist, 1mb JSON limit, global ValidationPipe.
  setupHttpApp(app, {
    trustProxyHops: config.getOrThrow<number>('TRUST_PROXY_HOPS'),
    corsOrigins: parseCorsOrigins(config.get<string>('CORS_ORIGINS')),
    corsAllowedHeaders: ['Idempotency-Key'],
  });

  // Resolved once in config validation (swaggerEnabled): explicit ENABLE_SWAGGER, else dev/test only.
  const swagger = config.get<string>('ENABLE_SWAGGER') === 'true';
  if (swagger) {
    setupSwagger(app, SWAGGER_OPTIONS);
  }

  await app.listen(port);
  const logger = app.get(Logger);
  logger.log(`Application running on port ${port}`, 'Bootstrap');
  if (swagger) {
    logger.log(`Swagger: http://localhost:${port}/docs`, 'Bootstrap');
  }
}

bootstrap().catch((err: Error) => {
  // The pino logger may not exist yet (config validation, DI errors).
  new NestLogger('Bootstrap').error(
    `Bootstrap failed: ${err.message}`,
    err.stack,
  );
  process.exit(1);
});
