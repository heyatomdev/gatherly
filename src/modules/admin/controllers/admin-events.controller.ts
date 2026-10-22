import {
  Body,
  Controller,
  Delete,
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
import { ApiOkData, ApiCreatedData } from '@/common/api-data';
import { ApiPaginatedResponse } from '@heyatom/nest-common';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { EventService } from '@/modules/events/event.service';
import {
  CreateEventDto,
  GetEventsQueryDto,
  UpdateEventDto,
} from '@/modules/events/dto/event.dto';
import {
  EventDetailResponseDto,
  EventResponseDto,
  EventStatsResponseDto,
  EventWithCountResponseDto,
} from '@/modules/events/dto/event-response.dto';

@ApiTags('admin/events')
@ApiBearerAuth()
@Controller('admin/events')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminEventsController {
  constructor(private readonly events: EventService) {}

  @Get()
  @ApiPaginatedResponse(EventWithCountResponseDto)
  list(@Request() req, @Query() query: GetEventsQueryDto) {
    return this.events.getEventsByClient(req.adminClient.id, query);
  }

  @Get(':id')
  @ApiOkData(EventDetailResponseDto)
  get(@Request() req, @Param('id') id: string) {
    return this.events.getEventById(id, req.adminClient.id);
  }

  @Get(':id/stats')
  @ApiOkData(EventStatsResponseDto)
  stats(@Request() req, @Param('id') id: string) {
    return this.events.getEventStats(id, req.adminClient.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedData(EventResponseDto)
  create(@Request() req, @Body() dto: CreateEventDto) {
    return this.events.createEvent(req.adminClient.id, dto);
  }

  @Patch(':id')
  @ApiOkData(EventResponseDto)
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.events.updateEvent(id, req.adminClient.id, dto);
  }

  /** DRAFT only (409 otherwise) — published events are cancelled, not deleted. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req, @Param('id') id: string) {
    return this.events.deleteEvent(id, req.adminClient.id);
  }

  @Put(':id/publish')
  @ApiOkData(EventResponseDto)
  @HttpCode(HttpStatus.OK)
  publish(@Request() req, @Param('id') id: string) {
    return this.events.publishEvent(id, req.adminClient.id);
  }

  @Put(':id/cancel')
  @ApiOkData(EventResponseDto)
  @HttpCode(HttpStatus.OK)
  cancel(@Request() req, @Param('id') id: string) {
    return this.events.cancelEvent(id, req.adminClient.id);
  }

  @Put(':id/complete')
  @ApiOkData(EventResponseDto)
  @HttpCode(HttpStatus.OK)
  complete(@Request() req, @Param('id') id: string) {
    return this.events.completeEvent(id, req.adminClient.id);
  }
}
