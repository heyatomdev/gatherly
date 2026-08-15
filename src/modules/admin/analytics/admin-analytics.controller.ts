import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { AdminAnalyticsService } from './admin-analytics.service';
import {
  BreakdownBy,
  BreakdownQueryDto,
  RetentionQueryDto,
  StatsQueryDto,
  TimeseriesInterval,
  TimeseriesMetric,
  TimeseriesQueryDto,
} from './dto/analytics-query.dto';

@ApiTags('admin/analytics')
@ApiBearerAuth()
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
@Controller('admin')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('stats')
  stats(@Request() req, @Query() query: StatsQueryDto) {
    return this.analytics.tenantStats(
      req.adminClient.id,
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  @Get('stats/timeseries')
  @ApiQuery({ name: 'metric', enum: TimeseriesMetric, required: false })
  @ApiQuery({ name: 'interval', enum: TimeseriesInterval, required: false })
  timeseries(@Request() req, @Query() query: TimeseriesQueryDto) {
    return this.analytics.timeseries(
      req.adminClient.id,
      query.metric ?? TimeseriesMetric.EVENTS,
      query.interval ?? TimeseriesInterval.MONTH,
      query.from ? new Date(query.from) : undefined,
      query.to ? new Date(query.to) : undefined,
    );
  }

  @Get('stats/breakdown')
  @ApiQuery({ name: 'by', enum: BreakdownBy, required: false })
  breakdown(@Request() req, @Query() query: BreakdownQueryDto) {
    return this.analytics.breakdown(req.adminClient.id, query.by ?? BreakdownBy.STATUS);
  }

  @Get('analytics/retention')
  retention(@Request() req, @Query() query: RetentionQueryDto) {
    return this.analytics.retention(
      req.adminClient.id,
      query.granularity ?? 'month',
      query.months ?? 12,
    );
  }
}
