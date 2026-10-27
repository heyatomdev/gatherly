import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CategoryResponseDto } from '../../categories/dto/category.dto';
import { TagResponseDto } from '../../tags/dto/tag.dto';

const STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] as const;
const P_STATUSES = [
  'REGISTERED',
  'WAITLIST',
  'CONFIRMED',
  'CANCELLED',
  'ATTENDED',
] as const;
const DATE = { type: String, format: 'date-time' } as const;

export class EventTranslationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() eventId: string;
  @ApiProperty({ example: 'it' }) locale: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true, type: String }) description:
    string | null;
}

export class EventTagResponseDto {
  @ApiProperty() eventId: string;
  @ApiProperty() tagId: string;
  @ApiProperty({ type: TagResponseDto }) tag: TagResponseDto;
}

export class RecurrenceRuleResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'FREQ=WEEKLY;BYDAY=MO' }) rule: string;
  @ApiPropertyOptional({ ...DATE, nullable: true }) endDate: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) count: number | null;
}

export class ParticipantCountDto {
  @ApiProperty({
    description: 'Seats taken: REGISTERED + CONFIRMED + ATTENDED',
  })
  participants: number;
}

export class EventResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() clientId: string;
  @ApiProperty({ example: 'it' }) defaultLocale: string;
  @ApiProperty() authorId: string;
  @ApiProperty() authorName: string;
  @ApiPropertyOptional({ nullable: true, type: String }) authorEmail:
    string | null;
  @ApiProperty(DATE) startTime: string;
  @ApiPropertyOptional({ ...DATE, nullable: true }) endTime: string | null;
  @ApiProperty({ example: 'Europe/Rome' }) timezone: string;
  @ApiProperty({ enum: STATUSES }) status: (typeof STATUSES)[number];
  @ApiPropertyOptional({ nullable: true, type: String }) type: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) coverImageUrl:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) categoryId:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) locationName:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) locationAddress:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) locationUrl:
    string | null;
  @ApiProperty() isOnline: boolean;
  @ApiPropertyOptional({ nullable: true, type: Number }) maxParticipants:
    number | null;
  @ApiProperty() isPublic: boolean;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    example: '12.50',
    description: 'Decimal, serialized as a string',
  })
  price: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, example: 'EUR' })
  currency: string | null;
  @ApiProperty(DATE) createdAt: string;
  @ApiProperty(DATE) updatedAt: string;
  @ApiPropertyOptional({ nullable: true, type: String }) recurrenceRuleId:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) parentEventId:
    string | null;
  @ApiProperty({ type: [EventTranslationResponseDto] })
  translations: EventTranslationResponseDto[];
  @ApiProperty({ type: [EventTagResponseDto] }) tags: EventTagResponseDto[];
  @ApiPropertyOptional({ type: CategoryResponseDto, nullable: true })
  category: CategoryResponseDto | null;
  @ApiPropertyOptional({ type: RecurrenceRuleResponseDto, nullable: true })
  recurrenceRule: RecurrenceRuleResponseDto | null;
}

/** List items and detail: `_count` is present on both, not on mutation responses. */
export class EventWithCountResponseDto extends EventResponseDto {
  @ApiProperty({ type: ParticipantCountDto }) _count: ParticipantCountDto;
}

export class ChildEventResponseDto {
  @ApiProperty() id: string;
  @ApiProperty(DATE) startTime: string;
  @ApiProperty({ enum: STATUSES }) status: (typeof STATUSES)[number];
  @ApiProperty({ type: ParticipantCountDto }) _count: ParticipantCountDto;
}

export class EventDetailResponseDto extends EventWithCountResponseDto {
  @ApiProperty({
    type: [ChildEventResponseDto],
    description: 'First 100 recurring children by startTime',
  })
  childEvents: ChildEventResponseDto[];
}

export class ParticipantResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() eventId: string;
  @ApiProperty({ enum: ['INLINE', 'EXTERNAL'] }) type: 'INLINE' | 'EXTERNAL';
  @ApiProperty() userName: string;
  @ApiPropertyOptional({ nullable: true, type: String }) email: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) externalId:
    string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) externalSource:
    string | null;
  @ApiProperty({ enum: P_STATUSES }) status: (typeof P_STATUSES)[number];
  @ApiProperty({ enum: ['ATTENDEE', 'SPEAKER', 'ORGANIZER', 'HOST'] })
  role: 'ATTENDEE' | 'SPEAKER' | 'ORGANIZER' | 'HOST';
  @ApiPropertyOptional({ nullable: true, type: String }) notes: string | null;
  @ApiProperty() checkedIn: boolean;
  @ApiPropertyOptional({ ...DATE, nullable: true }) checkedInAt: string | null;
  @ApiProperty(DATE) createdAt: string;
  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  metadata: Record<string, unknown> | null;
}

export class BulkAddErrorDto {
  @ApiProperty() index: number;
  @ApiProperty() reason: string;
}

export class BulkAddResultDto {
  @ApiProperty() added: number;
  @ApiProperty() waitlisted: number;
  @ApiProperty() skipped: number;
  @ApiProperty({ type: [BulkAddErrorDto] }) errors: BulkAddErrorDto[];
}

export class EventStatsDto {
  @ApiProperty() totalParticipants: number;
  @ApiProperty() registered: number;
  @ApiProperty() confirmed: number;
  @ApiProperty() waitlist: number;
  @ApiProperty() cancelled: number;
  @ApiProperty() attended: number;
  @ApiProperty() checkedIn: number;
  @ApiPropertyOptional({ nullable: true, type: Number }) availableSpots:
    number | null;
}

export class EventStatsResponseDto {
  @ApiProperty({ type: EventResponseDto }) event: EventResponseDto;
  @ApiProperty({ type: EventStatsDto }) stats: EventStatsDto;
}
