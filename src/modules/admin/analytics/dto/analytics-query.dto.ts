import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class StatsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export enum TimeseriesMetric {
  EVENTS = 'events',
  PARTICIPANTS = 'participants',
}

export enum TimeseriesInterval {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class TimeseriesQueryDto {
  @ApiPropertyOptional({ enum: TimeseriesMetric, default: TimeseriesMetric.EVENTS })
  @IsOptional()
  @IsEnum(TimeseriesMetric)
  metric?: TimeseriesMetric = TimeseriesMetric.EVENTS;

  @ApiPropertyOptional({ enum: TimeseriesInterval, default: TimeseriesInterval.MONTH })
  @IsOptional()
  @IsEnum(TimeseriesInterval)
  interval?: TimeseriesInterval = TimeseriesInterval.MONTH;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export enum BreakdownBy {
  CATEGORY = 'category',
  TAG = 'tag',
  STATUS = 'status',
}

export class BreakdownQueryDto {
  @ApiPropertyOptional({ enum: BreakdownBy, default: BreakdownBy.STATUS })
  @IsOptional()
  @IsEnum(BreakdownBy)
  by?: BreakdownBy = BreakdownBy.STATUS;
}

export class RetentionQueryDto {
  @ApiPropertyOptional({ default: 'month', enum: ['month', 'week'] })
  @IsOptional()
  granularity?: string = 'month';

  @ApiPropertyOptional({ default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number = 12;
}
