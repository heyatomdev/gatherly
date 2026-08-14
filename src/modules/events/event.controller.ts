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
  UseInterceptors,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { EventService } from './event.service';
import { WebhookService } from '../webhook/webhook.service';
import { IdempotencyInterceptor } from '@/common/idempotency.interceptor';
import {
  CreateEventDto,
  AddParticipantDto,
  UpdateEventDto,
  UpdateParticipantStatusDto,
  GetEventsQueryDto,
  GetParticipantsQueryDto,
  BulkAddParticipantsDto,
} from './dto/event.dto';

@ApiTags('events')
@Controller('events')
export class EventController {
  constructor(
    private eventService: EventService,
    private webhookService: WebhookService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create event with translations and optional tags' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'UUID from caller — retries return cached response' })
  async createEvent(@Request() req, @Body() dto: CreateEventDto) {
    return this.eventService.createEvent(req.client.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List events for client with optional filters and pagination' })
  async getEvents(@Request() req, @Query() query: GetEventsQueryDto) {
    return this.eventService.getEventsByClient(req.client.id, query);
  }

  @Get(':eventId')
  async getEvent(@Request() req, @Param('eventId') eventId: string) {
    return this.eventService.getEventById(eventId, req.client.id);
  }

  @Get(':eventId/stats')
  async getEventStats(@Request() req, @Param('eventId') eventId: string) {
    return this.eventService.getEventStats(eventId, req.client.id);
  }

  @Get(':eventId/participants')
  @ApiOperation({ summary: 'List participants with filters and pagination' })
  async getParticipants(
    @Request() req,
    @Param('eventId') eventId: string,
    @Query() query: GetParticipantsQueryDto,
  ) {
    return this.eventService.getParticipants(eventId, req.client.id, query);
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

  @Put(':eventId/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish event — validates required fields, transitions DRAFT → PUBLISHED' })
  async publishEvent(@Request() req, @Param('eventId') eventId: string) {
    const event = await this.eventService.publishEvent(eventId, req.client.id);
    await this.webhookService.notifyEventPublished(req.client.webhookUrl, req.client.id, event);
    return event;
  }

  @Put(':eventId/complete')
  @HttpCode(HttpStatus.OK)
  async completeEvent(@Request() req, @Param('eventId') eventId: string) {
    return this.eventService.completeEvent(eventId, req.client.id);
  }

  @Put(':eventId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel event — blocks further status changes. Cancels future recurring children.' })
  async cancelEvent(@Request() req, @Param('eventId') eventId: string) {
    const event = await this.eventService.cancelEvent(eventId, req.client.id);
    await this.webhookService.notifyEventCancelled(req.client.webhookUrl, req.client.id, event);
    return event;
  }

  @Post(':eventId/participants')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Add participant — INLINE (direct data) or EXTERNAL (externalId + externalSource)' })
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'UUID from caller — retries return cached response' })
  async addParticipant(
    @Request() req,
    @Param('eventId') eventId: string,
    @Body() dto: AddParticipantDto,
  ) {
    return this.eventService.addParticipant(eventId, req.client.id, dto);
  }

  @Post(':eventId/participants/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add multiple participants in one request. Returns counts of added/waitlisted/skipped/errors.' })
  async addParticipantsBulk(
    @Request() req,
    @Param('eventId') eventId: string,
    @Body() dto: BulkAddParticipantsDto,
  ) {
    return this.eventService.addParticipantsBulk(eventId, req.client.id, dto);
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
