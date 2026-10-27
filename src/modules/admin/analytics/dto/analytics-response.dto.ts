import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StatsEventsDto {
  @ApiProperty() draft: number;
  @ApiProperty() published: number;
  @ApiProperty() cancelled: number;
  @ApiProperty() completed: number;
  @ApiProperty() upcoming: number;
}

export class StatsParticipantsDto {
  @ApiProperty() total: number;
  @ApiProperty() active: number;
  @ApiProperty() checkedIn: number;
}

export class StatsRatesDto {
  @ApiProperty() avgFillRate: number;
  @ApiProperty() checkInRate: number;
  @ApiProperty() noShowRate: number;
}

export class StatsAlertsDto {
  @ApiProperty() soldOutWithWaitlist: number;
  @ApiProperty() staleDrafts: number;
  @ApiProperty() pastNotCompleted: number;
}

export class DailyPointDto {
  @ApiProperty({ description: 'Day, YYYY-MM-DD' }) bucket: string;
  @ApiProperty() value: number;
}

export class StatsTrendsDto {
  @ApiProperty({ type: [DailyPointDto] }) upcoming: DailyPointDto[];
}

export class TenantStatsResponseDto {
  @ApiProperty({ type: StatsEventsDto }) events: StatsEventsDto;
  @ApiProperty({ type: StatsParticipantsDto })
  participants: StatsParticipantsDto;
  @ApiProperty({ type: StatsRatesDto }) rates: StatsRatesDto;
  @ApiProperty({ type: StatsAlertsDto }) alerts: StatsAlertsDto;
  @ApiProperty({ type: StatsTrendsDto }) trends: StatsTrendsDto;
  @ApiProperty() version: string;
}

export class TimeseriesPointDto {
  @ApiProperty({ type: String, format: 'date-time' }) bucket: string;
  @ApiProperty() value: number;
}

export class TimeseriesResponseDto {
  @ApiProperty({ enum: ['events', 'participants'] }) metric: string;
  @ApiProperty({ enum: ['day', 'week', 'month'] }) interval: string;
  @ApiProperty({ type: [TimeseriesPointDto] }) data: TimeseriesPointDto[];
}

export class BreakdownRowDto {
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'status: label; category/tag: id',
  })
  id?: string | null;
  @ApiPropertyOptional({ description: 'status only' }) label?: string;
  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'category only',
  })
  name?: string | null;
  @ApiPropertyOptional({ description: 'tag only' }) slug?: string;
  @ApiProperty() count: number;
}

export class BreakdownResponseDto {
  @ApiProperty({ enum: ['status', 'category', 'tag'] }) by: string;
  @ApiProperty({ type: [BreakdownRowDto] }) data: BreakdownRowDto[];
}

export class RetentionCohortDto {
  @ApiProperty({ example: '2026-03', description: 'YYYY-MM' }) cohort: string;
  @ApiProperty() size: number;
  @ApiProperty({
    type: [Number],
    description: 'Share of the cohort active in each following period, 0..1',
  })
  retention: number[];
}

export class RetentionResponseDto {
  @ApiProperty({ enum: ['week', 'month'] }) granularity: string;
  @ApiProperty({ type: [RetentionCohortDto] }) cohorts: RetentionCohortDto[];
}
