import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { getAppVersion } from '@/common/app-version';
import { BreakdownBy, TimeseriesMetric } from './dto/analytics-query.dto';

/** Length of the forward-looking series behind the `upcoming` figure. Two weeks
 *  is enough shape for a sparkline without turning a quiet calendar into a flat
 *  line of zeroes. */
const UPCOMING_TREND_DAYS = 14;

@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async tenantStats(clientId: string, from?: Date, to?: Date) {
    const timeFilter: any = {};
    if (from || to) {
      timeFilter.startTime = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const fromClause = from ? Prisma.sql`AND e."startTime" >= ${from}` : Prisma.empty;
    const toClause = to ? Prisma.sql`AND e."startTime" <= ${to}` : Prisma.empty;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const upcomingWindowStart = new Date(now);
    upcomingWindowStart.setUTCHours(0, 0, 0, 0);
    const upcomingWindowEnd = new Date(
      upcomingWindowStart.getTime() + UPCOMING_TREND_DAYS * 24 * 60 * 60 * 1000,
    );

    const [
      byStatus,
      upcomingCount,
      upcomingDailyRows,
      participantStats,
      rateStats,
      soldOutRows,
      staleDrafts,
      pastNotCompleted,
    ] = await Promise.all([
      this.prisma.event.groupBy({
        by: ['status'],
        where: { clientId, ...timeFilter },
        _count: true,
      }),
      this.prisma.event.count({
        where: { clientId, status: 'PUBLISHED', startTime: { gt: now }, ...timeFilter },
      }),
      // Forward-looking, and deliberately NOT narrowed by `from`/`to`: the
      // window is "the next N days", not the slice the caller is inspecting.
      // Pairing it with a `from`/`to` filter would draw a series that stops
      // before the figure it sits under does.
      this.prisma.$queryRaw<Array<{ bucket: Date; value: number }>>`
        SELECT date_trunc('day', e."startTime") AS bucket, count(*)::int AS value
        FROM events e
        WHERE e."clientId" = ${clientId}
          AND e.status = 'PUBLISHED'
          AND e."startTime" >= ${upcomingWindowStart}
          AND e."startTime" < ${upcomingWindowEnd}
        GROUP BY 1
        ORDER BY 1
      `,
      this.prisma.$queryRaw<Array<{ total: number; active: number; checked_in: number }>>`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE p.status != 'CANCELLED')::int AS active,
          count(*) FILTER (WHERE p."checkedIn")::int AS checked_in
        FROM participants p
        JOIN events e ON e.id = p."eventId"
        WHERE e."clientId" = ${clientId}
        ${fromClause}
        ${toClause}
      `,
      this.prisma.$queryRaw<Array<{
        avg_fill_rate: number | null;
        checkin_rate: number | null;
        no_show_rate: number | null;
      }>>`
        SELECT
          AVG(CASE WHEN "maxParticipants" IS NOT NULL AND "maxParticipants" > 0
            THEN confirmed_count::float / "maxParticipants" ELSE NULL END) AS avg_fill_rate,
          SUM(checked_in_count)::float / NULLIF(SUM(active_count), 0) AS checkin_rate,
          1 - SUM(CASE WHEN status = 'COMPLETED' THEN checked_in_count ELSE 0 END)::float
            / NULLIF(SUM(CASE WHEN status = 'COMPLETED' THEN active_count ELSE 0 END), 0) AS no_show_rate
        FROM (
          SELECT
            e.id,
            e."maxParticipants",
            e.status,
            count(*) FILTER (WHERE p.status IN ('CONFIRMED', 'ATTENDED'))::int AS confirmed_count,
            count(*) FILTER (WHERE p.status NOT IN ('CANCELLED', 'WAITLIST'))::int AS active_count,
            count(*) FILTER (WHERE p."checkedIn")::int AS checked_in_count
          FROM events e
          LEFT JOIN participants p ON p."eventId" = e.id
          WHERE e."clientId" = ${clientId}
          ${fromClause}
          ${toClause}
          GROUP BY e.id, e."maxParticipants", e.status
        ) sub
      `,
      this.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count
        FROM events e
        WHERE e."clientId" = ${clientId}
          AND e.status = 'PUBLISHED'
          AND e."maxParticipants" IS NOT NULL
          AND (
            SELECT count(*) FROM participants p
            WHERE p."eventId" = e.id AND p.status IN ('CONFIRMED', 'ATTENDED')
          ) >= e."maxParticipants"
          AND (
            SELECT count(*) FROM participants p
            WHERE p."eventId" = e.id AND p.status = 'WAITLIST'
          ) > 0
      `,
      this.prisma.event.count({
        where: { clientId, status: 'DRAFT', createdAt: { lt: thirtyDaysAgo } },
      }),
      this.prisma.event.count({
        where: { clientId, status: 'PUBLISHED', startTime: { lt: now } },
      }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const s of byStatus) statusMap[s.status] = s._count;

    const p = participantStats[0] ?? { total: 0, active: 0, checked_in: 0 };
    const r = rateStats[0] ?? { avg_fill_rate: null, checkin_rate: null, no_show_rate: null };

    return {
      events: {
        draft: statusMap['DRAFT'] ?? 0,
        published: statusMap['PUBLISHED'] ?? 0,
        cancelled: statusMap['CANCELLED'] ?? 0,
        completed: statusMap['COMPLETED'] ?? 0,
        upcoming: upcomingCount,
      },
      participants: {
        total: p.total,
        active: p.active,
        checkedIn: p.checked_in,
      },
      rates: {
        avgFillRate: Math.round((r.avg_fill_rate ?? 0) * 100) / 100,
        checkInRate: Math.round((r.checkin_rate ?? 0) * 100) / 100,
        noShowRate: Math.round((r.no_show_rate ?? 0) * 100) / 100,
      },
      alerts: {
        soldOutWithWaitlist: soldOutRows[0]?.count ?? 0,
        staleDrafts,
        pastNotCompleted,
      },
      trends: {
        upcoming: fillDailySeries(
          upcomingWindowStart,
          UPCOMING_TREND_DAYS,
          upcomingDailyRows,
        ),
      },
      version: getAppVersion(),
    };
  }

  async timeseries(clientId: string, metric: string, interval: string, from?: Date, to?: Date) {
    const validIntervals = ['day', 'week', 'month'];
    const trunc = validIntervals.includes(interval) ? interval : 'month';

    const fromClause = from ? Prisma.sql`AND e."startTime" >= ${from}` : Prisma.empty;
    const toClause = to ? Prisma.sql`AND e."startTime" <= ${to}` : Prisma.empty;

    if (metric === TimeseriesMetric.PARTICIPANTS) {
      const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; value: number }>>`
        SELECT date_trunc(${trunc}, p."createdAt") AS bucket, count(*)::int AS value
        FROM participants p
        JOIN events e ON e.id = p."eventId"
        WHERE e."clientId" = ${clientId}
        ${fromClause}
        ${toClause}
        GROUP BY bucket ORDER BY bucket
      `;
      return { metric, interval: trunc, data: rows };
    }

    const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; value: number }>>`
      SELECT date_trunc(${trunc}, e."startTime") AS bucket, count(*)::int AS value
      FROM events e
      WHERE e."clientId" = ${clientId}
      ${fromClause}
      ${toClause}
      GROUP BY bucket ORDER BY bucket
    `;
    return { metric, interval: trunc, data: rows };
  }

  async breakdown(clientId: string, by: string) {
    if (by === BreakdownBy.STATUS) {
      const rows = await this.prisma.event.groupBy({
        by: ['status'],
        where: { clientId },
        _count: true,
      });
      return { by, data: rows.map((r) => ({ label: r.status, count: r._count })) };
    }

    if (by === BreakdownBy.CATEGORY) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string | null; name: string | null; count: number }>>`
        SELECT
          e."categoryId" AS id,
          (SELECT t.name FROM event_category_translations t
           WHERE t."categoryId" = e."categoryId" LIMIT 1) AS name,
          count(*)::int AS count
        FROM events e
        WHERE e."clientId" = ${clientId}
        GROUP BY e."categoryId"
        ORDER BY count DESC
      `;
      return { by, data: rows };
    }

    if (by === BreakdownBy.TAG) {
      const rows = await this.prisma.$queryRaw<Array<{ id: string; slug: string; count: number }>>`
        SELECT t.id, t.slug, count(et."eventId")::int AS count
        FROM tags t
        LEFT JOIN event_tags et ON et."tagId" = t.id
        LEFT JOIN events e ON e.id = et."eventId" AND e."clientId" = ${clientId}
        WHERE t."clientId" = ${clientId}
        GROUP BY t.id, t.slug
        ORDER BY count DESC
      `;
      return { by, data: rows };
    }

    throw new BadRequestException(`Invalid breakdown: ${by}`);
  }

  async retention(clientId: string, granularity: string, months: number) {
    const trunc = granularity === 'week' ? 'week' : 'month';
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    const rows = await this.prisma.$queryRaw<
      Array<{ cohort: Date; cohort_size: number; event_period: Date; active: number }>
    >`
      WITH person_events AS (
        SELECT
          CASE
            WHEN p."externalId" IS NOT NULL
              THEN 'ext:' || COALESCE(p."externalSource", '') || ':' || p."externalId"
            ELSE 'email:' || lower(trim(p.email))
          END AS key,
          date_trunc(${trunc}, e."startTime") AS event_period
        FROM participants p
        JOIN events e ON e.id = p."eventId"
        WHERE e."clientId" = ${clientId}
          AND e."startTime" >= ${cutoff}
          AND (p."externalId" IS NOT NULL OR p.email IS NOT NULL)
          AND p.status NOT IN ('CANCELLED', 'WAITLIST')
      ),
      first_seen AS (
        SELECT key, min(event_period) AS cohort
        FROM person_events
        GROUP BY key
      ),
      cohort_sizes AS (
        SELECT cohort, count(*)::int AS cohort_size
        FROM first_seen
        GROUP BY cohort
      ),
      retention_data AS (
        SELECT fs.cohort, pe.event_period, count(DISTINCT pe.key)::int AS active
        FROM first_seen fs
        JOIN person_events pe ON pe.key = fs.key
        GROUP BY fs.cohort, pe.event_period
      )
      SELECT cs.cohort, cs.cohort_size, rd.event_period, rd.active
      FROM cohort_sizes cs
      JOIN retention_data rd ON rd.cohort = cs.cohort
      ORDER BY cs.cohort, rd.event_period
    `;

    const cohortMap = new Map<
      string,
      { cohort: string; size: number; periods: Map<string, number> }
    >();

    for (const row of rows) {
      const cohortKey = row.cohort.toISOString().slice(0, 7);
      if (!cohortMap.has(cohortKey)) {
        cohortMap.set(cohortKey, { cohort: cohortKey, size: row.cohort_size, periods: new Map() });
      }
      const periodKey = row.event_period.toISOString().slice(0, 7);
      cohortMap.get(cohortKey)!.periods.set(periodKey, row.active);
    }

    const cohorts = Array.from(cohortMap.values()).map(({ cohort, size, periods }) => {
      const sortedPeriods = Array.from(periods.keys()).sort();
      const retention = sortedPeriods.map((pk) => {
        const active = periods.get(pk) ?? 0;
        return Math.round((active / size) * 100) / 100;
      });
      return { cohort, size, retention };
    });

    return { granularity: trunc, cohorts };
  }
}

/**
 * Zero-fills the days no event falls on, so the series always carries one point
 * per day. A series built from the returned rows alone would compress an empty
 * week into a single step and draw a slope that never happened.
 */
function fillDailySeries(
  start: Date,
  days: number,
  rows: Array<{ bucket: Date; value: number }>,
): Array<{ bucket: string; value: number }> {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    byDay.set(new Date(row.bucket).toISOString().slice(0, 10), row.value);
  }

  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start.getTime() + i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return { bucket: day, value: byDay.get(day) ?? 0 };
  });
}
