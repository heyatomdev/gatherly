import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from "@/modules/prisma/prisma.module";
import {ClientModule} from "@/modules/clients/client.module";
import {EventModule} from "@/modules/events/event.module";
import {CategoryModule} from "@/modules/categories/category.module";
import {TagModule} from "@/modules/tags/tag.module";
import { HealthModule } from '@/modules/health/health.module';
import { BastionModule } from '@/modules/bastion/bastion.module';
import { BastionJwtGuard } from '@/modules/bastion/guards/bastion-jwt.guard';
import { AdminModule } from '@/modules/admin/admin.module';
import { RequestIdMiddleware } from '@/middleware/request-id.middleware';
import { validate } from '@/configs/config.validation';
import { APP_GUARD } from '@nestjs/core';

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
            useFactory: (config: ConfigService) => ([{
                ttl: config.get<number>('THROTTLE_TTL_MS') ?? 60_000,
                limit: config.get<number>('THROTTLE_LIMIT') ?? 100,
            }]),
        }),
        LoggerModule.forRoot({
            pinoHttp: {
                level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
                transport:
                  process.env.NODE_ENV !== 'production'
                    ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
                    : undefined,
                redact: {
                    paths: [
                        'req.headers.authorization',
                        'req.headers.cookie',
                        'req.headers["x-internal-secret"]',
                    ],
                    remove: true,
                },
                genReqId: (req) =>
                  (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
                serializers: {
                    req: (req) => ({ method: req.method, url: req.url, ip: req.remoteAddress }),
                    res: (res) => ({ statusCode: res.statusCode }),
                },
                customProps: () => ({ service: 'gatherly' }),
                autoLogging: { ignore: (req) => req.url === '/health' },
            },
        }),
        // Scheduling for jobs
        ScheduleModule.forRoot(),
        // Core modules
        PrismaModule,
        BastionModule,
        HealthModule,
        ClientModule,
        EventModule,
        CategoryModule,
        TagModule,
        AdminModule,
    ],
    providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: BastionJwtGuard },
    ],
})

export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        consumer.apply(RequestIdMiddleware).forRoutes('*');
    }
}

