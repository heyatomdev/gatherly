import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { ClientAuthGuard } from '@/guards/client-auth.guard';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [EventController],
  providers: [EventService, ClientAuthGuard],
  exports: [EventService],
})
export class EventModule {}
