import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ClientAuthGuard } from '@/guards/client-auth.guard';
import { CategoryModule } from '../categories/category.module';

@Module({
  imports: [ScheduleModule.forRoot(), CategoryModule],
  controllers: [EventController],
  providers: [EventService, PrismaService, ClientAuthGuard],
  exports: [EventService],
})
export class EventModule {}

