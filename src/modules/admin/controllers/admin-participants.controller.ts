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
  AddParticipantDto,
  BulkAddParticipantsDto,
  GetParticipantsQueryDto,
  UpdateParticipantStatusDto,
} from '@/modules/events/dto/event.dto';
import {
  BulkAddResultDto,
  ParticipantResponseDto,
} from '@/modules/events/dto/event-response.dto';

@ApiTags('admin/events')
@ApiBearerAuth()
@Controller('admin/events/:eventId/participants')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminParticipantsController {
  constructor(private readonly events: EventService) {}

  @Get()
  @ApiPaginatedResponse(ParticipantResponseDto)
  list(
    @Request() req,
    @Param('eventId') eventId: string,
    @Query() query: GetParticipantsQueryDto,
  ) {
    return this.events.getParticipants(eventId, req.adminClient.id, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedData(ParticipantResponseDto)
  add(
    @Request() req,
    @Param('eventId') eventId: string,
    @Body() dto: AddParticipantDto,
  ) {
    return this.events.addParticipant(eventId, req.adminClient.id, dto);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOkData(BulkAddResultDto)
  addBulk(
    @Request() req,
    @Param('eventId') eventId: string,
    @Body() dto: BulkAddParticipantsDto,
  ) {
    return this.events.addParticipantsBulk(eventId, req.adminClient.id, dto);
  }

  @Patch(':participantId/status')
  @ApiOkData(ParticipantResponseDto)
  updateStatus(
    @Request() req,
    @Param('eventId') eventId: string,
    @Param('participantId') participantId: string,
    @Body() body: UpdateParticipantStatusDto,
  ) {
    return this.events.updateParticipantStatus(
      participantId,
      eventId,
      req.adminClient.id,
      body.status,
    );
  }

  @Put(':participantId/checkin')
  @HttpCode(HttpStatus.OK)
  @ApiOkData(ParticipantResponseDto)
  checkIn(
    @Request() req,
    @Param('eventId') eventId: string,
    @Param('participantId') participantId: string,
  ) {
    return this.events.checkInParticipant(
      participantId,
      eventId,
      req.adminClient.id,
    );
  }

  @Delete(':participantId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Request() req,
    @Param('eventId') eventId: string,
    @Param('participantId') participantId: string,
  ) {
    return this.events.removeParticipant(
      eventId,
      req.adminClient.id,
      participantId,
    );
  }
}
