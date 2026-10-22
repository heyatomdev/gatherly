import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DATE = { type: String, format: 'date-time' } as const;
const SEGMENTS = ['vip', 'at_risk', 'returning', 'new'] as const;

export class PersonExternalDto {
  @ApiPropertyOptional({ nullable: true, type: String }) source: string | null;
  @ApiProperty() id: string;
}

export class PersonSummaryDto {
  @ApiProperty({ example: 'p_0123456789abcdef0123456789abcdef' }) key: string;
  @ApiProperty() displayName: string;
  @ApiPropertyOptional({ nullable: true, type: String }) email: string | null;
  @ApiPropertyOptional({ type: PersonExternalDto, nullable: true })
  external: PersonExternalDto | null;
  @ApiProperty() eventsCount: number;
  @ApiProperty(DATE) firstSeen: string;
  @ApiProperty(DATE) lastSeen: string;
  @ApiProperty() checkedInCount: number;
  @ApiProperty() noShowCount: number;
  @ApiProperty({ enum: SEGMENTS }) segment: (typeof SEGMENTS)[number];
}

export class PersonHistoryDto {
  @ApiProperty() eventId: string;
  @ApiPropertyOptional({ nullable: true, type: String }) title: string | null;
  @ApiProperty(DATE) startTime: string;
  @ApiProperty() status: string;
  @ApiProperty() checkedIn: boolean;
}

export class PersonTopCategoryDto {
  @ApiPropertyOptional({ nullable: true, type: String }) id: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) name: string | null;
  @ApiProperty() frequency: number;
}

export class PersonTopTagDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() frequency: number;
}

export class PersonProfileResponseDto extends PersonSummaryDto {
  @ApiProperty({ type: [PersonHistoryDto] }) history: PersonHistoryDto[];
  @ApiProperty({ type: [PersonTopCategoryDto] })
  topCategories: PersonTopCategoryDto[];
  @ApiProperty({ type: [PersonTopTagDto] }) topTags: PersonTopTagDto[];
}
