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
import { EventService } from './event.service';
import { ClientAuthGuard } from '@/guards/client-auth.guard';
import {
  CreateEventDto,
  AddParticipantDto,
  UpdateEventDto,
  UpdateParticipantStatusDto,
} from './dto/event.dto';

@Controller('events')
@UseGuards(ClientAuthGuard)
export class EventController {
  constructor(private eventService: EventService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createEvent(@Request() req, @Body() createEventDto: CreateEventDto) {
    return this.eventService.createEvent(req.client.id, createEventDto);
  }

  @Get()
  async getEvents(
    @Request() req,
    @Query('status') status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED',
    @Query('type') type?: string,
    @Query('categoryId') categoryId?: string,
    @Query('isOnline') isOnline?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.eventService.getEventsByClient(req.client.id, {
      status,
      type,
      categoryId,
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
  async updateEvent(
    @Request() req,
    @Param('eventId') eventId: string,
    @Body() data: UpdateEventDto,
  ) {
    return this.eventService.updateEvent(eventId, req.client.id, data);
  }

  @Put(':eventId/complete')
  async completeEvent(@Request() req, @Param('eventId') eventId: string) {
    return this.eventService.completeEvent(eventId, req.client.id);
  }

  @Post(':eventId/participants')
  @HttpCode(HttpStatus.CREATED)
  async addParticipant(
    @Request() req,
    @Param('eventId') eventId: string,
    @Body() data: AddParticipantDto,
  ) {
    return this.eventService.addParticipant(eventId, req.client.id, data);
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
    return this.eventService.checkInParticipant(
      participantId,
      eventId,
      req.client.id,
    );
  }

  @Delete(':eventId/participants/:userId')
  @HttpCode(HttpStatus.OK)
  async removeParticipant(
    @Request() req,
    @Param('eventId') eventId: string,
    @Param('userId') userId: string,
  ) {
    return this.eventService.removeParticipant(eventId, req.client.id, userId);
  }
}

