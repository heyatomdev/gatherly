import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { EventService } from '@/modules/events/event.service';
import {
  CreateEventDto,
  GetEventsQueryDto,
  UpdateEventDto,
} from '@/modules/events/dto/event.dto';

@ApiTags('admin/events')
@ApiBearerAuth()
@Controller('admin/events')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminEventsController {
  constructor(private readonly events: EventService) {}

  @Get()
  list(@Request() req, @Query() query: GetEventsQueryDto) {
    return this.events.getEventsByClient(req.adminClient.id, query);
  }

  @Get(':id')
  get(@Request() req, @Param('id') id: string) {
    return this.events.getEventById(id, req.adminClient.id);
  }

  @Get(':id/stats')
  stats(@Request() req, @Param('id') id: string) {
    return this.events.getEventStats(id, req.adminClient.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req, @Body() dto: CreateEventDto) {
    return this.events.createEvent(req.adminClient.id, dto);
  }

  @Patch(':id')
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.updateEvent(id, req.adminClient.id, dto);
  }

  @Put(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Request() req, @Param('id') id: string) {
    return this.events.publishEvent(id, req.adminClient.id);
  }

  @Put(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Request() req, @Param('id') id: string) {
    return this.events.cancelEvent(id, req.adminClient.id);
  }

  @Put(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Request() req, @Param('id') id: string) {
    return this.events.completeEvent(id, req.adminClient.id);
  }
}
