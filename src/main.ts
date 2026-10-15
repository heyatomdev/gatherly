import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app/app.module';
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { setupSwagger } from '@heyatom/nest-common';
import { APP_VERSION } from './common/app-version';

async function bootstrap() {

  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  app.use(helmet());

  // Defaults live in config.validation.ts — single source of truth.
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT');
  const isProduction = config.get<string>('NODE_ENV') === 'production';
  const allowedOrigins = config.get<string>('CORS_ORIGINS', '').split(',').map((o) => o.trim()).filter(Boolean);

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Resolved once in config validation (swaggerEnabled): explicit ENABLE_SWAGGER, else dev/test only.
  const swagger = config.get<string>('ENABLE_SWAGGER') === 'true';
  if (swagger) {
    setupSwagger(app, { title: 'Gatherly', version: APP_VERSION, configure: (b) => b.addBearerAuth() });
  }

  await app.listen(port);
  const pinoLogger = app.get(Logger);
  pinoLogger.log(`Application running on port ${port}`, 'Bootstrap');
  if (swagger) {
    pinoLogger.log(`Swagger: http://localhost:${port}/docs`, 'Bootstrap');
  }
}

bootstrap();
