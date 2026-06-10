import {
  IsString,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsNumber,
  IsArray,
  IsEnum,
  IsUrl,
  IsObject,
  Min,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EventTranslationDto {
  @ApiProperty({ example: 'it' })
  @IsString()
  @MaxLength(10)
  locale: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class CreateEventDto {
  @ApiProperty({ type: [EventTranslationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EventTranslationDto)
  translations: EventTranslationDto[];

  @ApiPropertyOptional({ default: 'it' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultLocale?: string;

  @ApiProperty()
  @IsString()
  authorId: string;

  @ApiProperty()
  @IsString()
  authorName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  authorEmail?: string;

  @ApiProperty()
  @IsDateString()
  startTime: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endTime?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] })
  @IsOptional()
  @IsEnum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  coverImageUrl?: string;

  @ApiPropertyOptional({ type: [String], description: 'Tag slugs — created if not exist' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagSlugs?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  locationUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxParticipants?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'iCal RRULE string e.g. FREQ=WEEKLY;BYDAY=MO' })
  @IsOptional()
  @IsString()
  recurrenceRule?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  recurrenceEndDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  recurrenceCount?: number;
}

export class UpdateEventDto {
  @ApiPropertyOptional({ type: [EventTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EventTranslationDto)
  translations?: EventTranslationDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagSlugs?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startTime?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endTime?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] })
  @IsOptional()
  @IsEnum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  coverImageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  locationUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  maxParticipants?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;
}

export class AddParticipantDto {
  @ApiPropertyOptional({ enum: ['INLINE', 'EXTERNAL'], default: 'INLINE' })
  @IsOptional()
  @IsEnum(['INLINE', 'EXTERNAL'])
  type?: 'INLINE' | 'EXTERNAL';

  @ApiProperty()
  @IsString()
  userName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'External user ID from third-party app' })
  @IsOptional()
  @IsString()
  externalId?: string;

  @ApiPropertyOptional({ description: 'Source identifier e.g. "discord", "steam"' })
  @IsOptional()
  @IsString()
  externalSource?: string;

  @ApiPropertyOptional({ enum: ['ATTENDEE', 'SPEAKER', 'ORGANIZER', 'HOST'] })
  @IsOptional()
  @IsEnum(['ATTENDEE', 'SPEAKER', 'ORGANIZER', 'HOST'])
  role?: 'ATTENDEE' | 'SPEAKER' | 'ORGANIZER' | 'HOST';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Domain-specific data e.g. {team: "RedTeam", rank: 3}' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateParticipantStatusDto {
  @ApiProperty({ enum: ['REGISTERED', 'WAITLIST', 'CONFIRMED', 'CANCELLED', 'ATTENDED'] })
  @IsEnum(['REGISTERED', 'WAITLIST', 'CONFIRMED', 'CANCELLED', 'ATTENDED'])
  status: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED';
}
