import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app/app.module';
import {HttpExceptionFilter} from "@/filters/http-exception.filter";
import {Logger, ValidationPipe} from "@nestjs/common";
import { json } from 'express';
import {DocumentBuilder, SwaggerModule} from "@nestjs/swagger";

function getErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }

  return { message: String(error) };
}

async function bootstrap() {

  try {
    const app = await NestFactory.create(AppModule, {
      bufferLogs: true,
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });

    // Global validation pipe
    app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
    );

    // Enable CORS
    app.enableCors({
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-API-Key', 'X-User-Id'],
      credentials: true,
    });

    // Use global exception filter
    app.useGlobalFilters(new HttpExceptionFilter());

    app.use(json({ limit: '5mb' }));

    // Swagger documentation
    const config = new DocumentBuilder()
        .setTitle('Gatherly')
        .setDescription('Multi-tenant event management system API')
        .setVersion(process?.env?.npm_package_version || '2.0.0')
        .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
        .setLicense(
            'MIT',
            'https://github.com/heyatomdev/gatherly/blob/main/README.md',
        )
        .setContact('Andrea Tombolato', 'https://heyatom.dev', 'hey@heyatom.dev')
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('/docs', app, document);

    const port = process.env.PORT || 3000;
    await app.listen(port);

    const logger = new Logger('Bootstrap');
    logger.log(`🚀 Gatherly started successfully!`);
    logger.log(`📚 API Documentation: http://localhost:${port}/docs`);
    logger.log(`📈 Metrics endpoint: http://localhost:${port}/metrics`);
    logger.log(`📝 Logging enabled for: log, error, warn, debug, verbose`);
    logger.log(`Current BASE_URL is set to: ${process.env.BASE_URL || 'Not Set'}`);

  } catch (error) {
    const { message, stack } = getErrorDetails(error);

    Logger.error('❌ Failed to start the application', 'Bootstrap');

    if (message.includes('Database connection failed')) {
      Logger.error('Database connection issue detected', 'Bootstrap');
    } else if (message.includes('EADDRINUSE')) {
      Logger.error(`Port is already in use. Another service might be running on the same port`, 'Bootstrap');
    } else if (message.includes('EACCES')) {
      Logger.error(`Permission denied. You might not have permission to bind to this port`, 'Bootstrap');
    } else {
      Logger.error(`Unexpected error: ${message}`, 'Bootstrap');
    }

    Logger.error('Stack trace:', stack ?? 'N/A', 'Bootstrap');
    throw error;
  }
}

bootstrap()
    .then((app) => {
      Logger.log('🎉 App running now!', 'Bootstrap');
    })
    .catch((error) => {
      const { message } = getErrorDetails(error);

      Logger.error('💥 Critical error during application startup:', 'Bootstrap');
      Logger.error(message, 'Bootstrap');
      Logger.error('🔄 Please fix the issues above and try again', 'Bootstrap');
      process.exit(1);
    });
