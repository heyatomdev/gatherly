import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { EventService } from './event.service';
import { ClientAuthGuard } from '@/guards/client-auth.guard';
import {
  CreateEventDto,
  AddParticipantDto,
  UpdateEventDto,
  UpdateParticipantStatusDto,
} from './dto/event.dto';

@ApiTags('events')
@Controller('events')
@UseGuards(ClientAuthGuard)
export class EventController {
  constructor(private eventService: EventService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create event with translations and optional tags' })
  async createEvent(@Request() req, @Body() dto: CreateEventDto) {
    return this.eventService.createEvent(req.client.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List events for client with optional filters' })
  async getEvents(
    @Request() req,
    @Query('status') status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED',
    @Query('type') type?: string,
    @Query('categoryId') categoryId?: string,
    @Query('tagId') tagId?: string,
    @Query('isOnline') isOnline?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.eventService.getEventsByClient(req.client.id, {
      status,
      type,
      categoryId,
      tagId,
      isOnline: isOnline === 'true' ? true : isOnline === 'false' ? false : undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
  }

  @Get(':eventId')
  async getEvent(@Request() req, @Param('eventId') eventId: string) {
    return this.eventService.getEventById(eventId, req.client.id);
  }

  @Get(':eventId/stats')
  async getEventStats(@Request() req, @Param('eventId') eventId: string) {
    return this.eventService.getEventStats(eventId, req.client.id);
  }

  @Patch(':eventId')
  @ApiOperation({ summary: 'Update event — pass translations to upsert, tagSlugs to replace all tags' })
  async updateEvent(
    @Request() req,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventService.updateEvent(eventId, req.client.id, dto);
  }

  @Put(':eventId/complete')
  async completeEvent(@Request() req, @Param('eventId') eventId: string) {
    return this.eventService.completeEvent(eventId, req.client.id);
  }

  @Post(':eventId/participants')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add participant — INLINE (direct data) or EXTERNAL (externalId + externalSource)' })
  async addParticipant(
    @Request() req,
    @Param('eventId') eventId: string,
    @Body() dto: AddParticipantDto,
  ) {
    return this.eventService.addParticipant(eventId, req.client.id, dto);
  }

  @Patch(':eventId/participants/:participantId/status')
  async updateParticipantStatus(
    @Request() req,
    @Param('eventId') eventId: string,
    @Param('participantId') participantId: string,
    @Body() body: UpdateParticipantStatusDto,
  ) {
    return this.eventService.updateParticipantStatus(
      participantId,
      eventId,
      req.client.id,
      body.status,
    );
  }

  @Put(':eventId/participants/:participantId/checkin')
  async checkInParticipant(
    @Request() req,
    @Param('eventId') eventId: string,
    @Param('participantId') participantId: string,
  ) {
    return this.eventService.checkInParticipant(participantId, eventId, req.client.id);
  }

  @Delete(':eventId/participants/:participantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel participant by participantId (marks as CANCELLED, promotes waitlist)' })
  async removeParticipant(
    @Request() req,
    @Param('eventId') eventId: string,
    @Param('participantId') participantId: string,
  ) {
    return this.eventService.removeParticipant(eventId, req.client.id, participantId);
  }
}
