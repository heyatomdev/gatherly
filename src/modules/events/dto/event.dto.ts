import {
  IsString,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsNumber,
  IsArray,
  IsEnum,
  IsUrl,
  Min,
  MaxLength
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateEventDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsString()
  authorId: string;

  @IsString()
  authorName: string;

  @IsOptional()
  @IsString()
  authorEmail?: string;

  @IsDateString()
  startTime: Date;

  @IsOptional()
  @IsDateString()
  endTime?: Date;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsEnum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsUrl()
  coverImageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsString()
  locationAddress?: string;

  @IsOptional()
  @IsUrl()
  locationUrl?: string;

  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxParticipants?: number;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  recurrenceRule?: string;

  @IsOptional()
  @IsDateString()
  recurrenceEndDate?: Date;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  recurrenceCount?: number;
}

export class AddParticipantDto {
  @IsString()
  userId: string;

  @IsString()
  userName: string;

  @IsOptional()
  @IsEnum(['ATTENDEE', 'SPEAKER', 'ORGANIZER', 'HOST'])
  role?: 'ATTENDEE' | 'SPEAKER' | 'ORGANIZER' | 'HOST';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsDateString()
  startTime?: Date;

  @IsOptional()
  @IsDateString()
  endTime?: Date;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsEnum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsUrl()
  coverImageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsString()
  locationAddress?: string;

  @IsOptional()
  @IsUrl()
  locationUrl?: string;

  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxParticipants?: number;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class UpdateParticipantStatusDto {
  @IsEnum(['REGISTERED', 'WAITLIST', 'CONFIRMED', 'CANCELLED', 'ATTENDED'])
  status: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED';
}

// Response DTOs

export class ParticipantResponseDto {
  id: string;
  eventId: string;
  userId: string;
  userName: string;
  status: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED';
  role: 'ATTENDEE' | 'SPEAKER' | 'ORGANIZER' | 'HOST';
  notes?: string;
  checkedIn: boolean;
  checkedInAt?: Date;
  createdAt: Date;
}

export class EventCategoryResponseDto {
  id: string;
  name: string;
  color?: string;
  icon?: string;
}

export class EventResponseDto {
  id: string;
  title: string;
  description?: string;
  clientId: string;
  authorId: string;
  authorName: string;
  authorEmail?: string;
  startTime: Date;
  endTime?: Date;
  timezone: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
  type?: string;
  coverImageUrl?: string;
  tags?: string[];
  categoryId?: string;
  category?: EventCategoryResponseDto;
  locationName?: string;
  locationAddress?: string;
  locationUrl?: string;
  isOnline: boolean;
  maxParticipants?: number;
  isPublic: boolean;
  price?: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  isRecurring: boolean;
  recurrenceRule?: string;
  recurrenceEndDate?: Date;
  recurrenceCount?: number;
  parentEventId?: string;
  participants?: ParticipantResponseDto[];
  childEvents?: EventResponseDto[];
}

export class EventStatsDto {
  totalParticipants: number;
  registered: number;
  confirmed: number;
  waitlist: number;
  cancelled: number;
  attended: number;
  checkedIn: number;
  availableSpots: number | null;
}

export class EventStatsResponseDto {
  event: EventResponseDto;
  stats: EventStatsDto;
}

