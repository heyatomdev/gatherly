import { Module } from '@nestjs/common';
import { StatusController } from './status.controller';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from "@nestjs/schedule";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import config from '../../configs/config.schema';
import { configValidationSchema } from '@/configs/config.validation';
import {ClientModule} from "@/modules/clients/client.module";
import {EventModule} from "@/modules/events/event.module";
import {CategoryModule} from "@/modules/categories/category.module";

@Module({
    controllers: [StatusController],
    imports: [
        // Configuration
        ConfigModule.forRoot({
            load: [config],
            isGlobal: true,
            cache: true,
            validationSchema: configValidationSchema,
        }),

        // Scheduling for jobs
        ScheduleModule.forRoot(),

        // Core modules
        PrismaModule,
        ClientModule,
        EventModule,
        CategoryModule
    ],
})
export class AppModule {}

