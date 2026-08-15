import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { PeopleQueryDto } from './dto/people-query.dto';

@Injectable()
export class AdminPeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private buildKeyPredicate(key: string): Prisma.Sql {
    if (key.startsWith('ext:')) {
      const rest = key.slice(4);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) throw new BadRequestException('Invalid person key');
      const source = rest.slice(0, colonIdx);
      const externalId = rest.slice(colonIdx + 1);
      return Prisma.sql`(p."externalSource" = ${source} AND p."externalId" = ${externalId})`;
    }
    if (key.startsWith('email:')) {
      const email = key.slice(6).toLowerCase().trim();
      return Prisma.sql`lower(trim(p.email)) = ${email}`;
    }
    throw new BadRequestException('Invalid person key format');
  }

  async listPeople(clientId: string, query: PeopleQueryDto) {
    const { search, segment, minEvents = 1, page = 1, limit = 20 } = query;
    const offset = (page - 1) * limit;
    const vipThreshold = this.config.get<number>('VIP_THRESHOLD') ?? 5;
    const atRiskDays = this.config.get<number>('AT_RISK_DAYS') ?? 120;

    const searchFilter = search
      ? Prisma.sql`AND (agg.display_name ILIKE ${`%${search}%`} OR agg.email ILIKE ${`%${search}%`})`
      : Prisma.empty;

    const segmentFilter = segment
      ? Prisma.sql`AND agg.segment = ${segment}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{
        key: string;
        display_name: string;
        email: string | null;
        external_id: string | null;
        external_source: string | null;
        events_count: number;
        first_seen: Date;
        last_seen: Date;
        checked_in_count: number;
        no_show_count: number;
        segment: string;
        total_count: number;
      }>
    >`
      WITH people AS (
        SELECT
          CASE
            WHEN p."externalId" IS NOT NULL
              THEN 'ext:' || COALESCE(p."externalSource", '') || ':' || p."externalId"
            ELSE 'email:' || lower(trim(p.email))
          END AS key,
          p."userName",
          p.email,
          p."externalId",
          p."externalSource",
          p."checkedIn",
          p.status AS participant_status,
          e."startTime",
          e.id AS event_id
        FROM participants p
        JOIN events e ON e.id = p."eventId"
        WHERE e."clientId" = ${clientId}
          AND (p."externalId" IS NOT NULL OR p.email IS NOT NULL)
      ),
      agg AS (
        SELECT
          key,
          (array_agg("userName" ORDER BY "startTime" DESC))[1] AS display_name,
          max(email) AS email,
          max("externalId") AS external_id,
          max("externalSource") AS external_source,
          count(DISTINCT event_id)::int AS events_count,
          min("startTime") AS first_seen,
          max("startTime") AS last_seen,
          count(*) FILTER (WHERE "checkedIn")::int AS checked_in_count,
          count(*) FILTER (
            WHERE NOT "checkedIn"
              AND "startTime" < NOW()
              AND participant_status IN ('CONFIRMED', 'REGISTERED', 'ATTENDED')
          )::int AS no_show_count,
          CASE
            WHEN count(DISTINCT event_id) >= ${vipThreshold} THEN 'vip'
            WHEN count(DISTINCT event_id) >= 2
              AND max("startTime") < NOW() - (${atRiskDays} * INTERVAL '1 day') THEN 'at_risk'
            WHEN count(DISTINCT event_id) >= 2 THEN 'returning'
            ELSE 'new'
          END AS segment
        FROM people
        GROUP BY key
        HAVING count(DISTINCT event_id) >= ${minEvents}
      )
      SELECT agg.*, count(*) OVER()::int AS total_count
      FROM agg
      WHERE 1=1
      ${searchFilter}
      ${segmentFilter}
      ORDER BY agg.events_count DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const total = rows[0]?.total_count ?? 0;

    return {
      data: rows.map((r) => ({
        key: r.key,
        displayName: r.display_name,
        email: r.email,
        external: r.external_id ? { source: r.external_source, id: r.external_id } : null,
        eventsCount: r.events_count,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        checkedInCount: r.checked_in_count,
        noShowCount: r.no_show_count,
        segment: r.segment,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPersonProfile(clientId: string, key: string) {
    const predicate = this.buildKeyPredicate(key);
    const vipThreshold = this.config.get<number>('VIP_THRESHOLD') ?? 5;
    const atRiskDays = this.config.get<number>('AT_RISK_DAYS') ?? 120;

    const [summaryRows, historyRows, topCategories, topTags] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          display_name: string;
          email: string | null;
          external_id: string | null;
          external_source: string | null;
          events_count: number;
          first_seen: Date;
          last_seen: Date;
          checked_in_count: number;
          no_show_count: number;
          segment: string;
        }>
      >`
        WITH people AS (
          SELECT
            p."userName",
            p.email,
            p."externalId",
            p."externalSource",
            p."checkedIn",
            p.status AS participant_status,
            e."startTime",
            e.id AS event_id
          FROM participants p
          JOIN events e ON e.id = p."eventId"
          WHERE e."clientId" = ${clientId} AND ${predicate}
        )
        SELECT
          (array_agg("userName" ORDER BY "startTime" DESC))[1] AS display_name,
          max(email) AS email,
          max("externalId") AS external_id,
          max("externalSource") AS external_source,
          count(DISTINCT event_id)::int AS events_count,
          min("startTime") AS first_seen,
          max("startTime") AS last_seen,
          count(*) FILTER (WHERE "checkedIn")::int AS checked_in_count,
          count(*) FILTER (
            WHERE NOT "checkedIn"
              AND "startTime" < NOW()
              AND participant_status IN ('CONFIRMED', 'REGISTERED', 'ATTENDED')
          )::int AS no_show_count,
          CASE
            WHEN count(DISTINCT event_id) >= ${vipThreshold} THEN 'vip'
            WHEN count(DISTINCT event_id) >= 2
              AND max("startTime") < NOW() - (${atRiskDays} * INTERVAL '1 day') THEN 'at_risk'
            WHEN count(DISTINCT event_id) >= 2 THEN 'returning'
            ELSE 'new'
          END AS segment
        FROM people
      `,
      this.prisma.$queryRaw<
        Array<{
          event_id: string;
          title: string | null;
          start_time: Date;
          status: string;
          checked_in: boolean;
        }>
      >`
        SELECT
          e.id AS event_id,
          (SELECT t.title FROM event_translations t WHERE t."eventId" = e.id LIMIT 1) AS title,
          e."startTime" AS start_time,
          p.status,
          p."checkedIn" AS checked_in
        FROM participants p
        JOIN events e ON e.id = p."eventId"
        WHERE e."clientId" = ${clientId} AND ${predicate}
        ORDER BY e."startTime" DESC
      `,
      this.prisma.$queryRaw<Array<{ category_id: string | null; name: string | null; frequency: number }>>`
        SELECT
          e."categoryId" AS category_id,
          (SELECT t.name FROM event_category_translations t
           WHERE t."categoryId" = e."categoryId" LIMIT 1) AS name,
          count(*)::int AS frequency
        FROM participants p
        JOIN events e ON e.id = p."eventId"
        WHERE e."clientId" = ${clientId}
          AND e."categoryId" IS NOT NULL
          AND ${predicate}
        GROUP BY e."categoryId"
        ORDER BY frequency DESC
        LIMIT 5
      `,
      this.prisma.$queryRaw<Array<{ id: string; slug: string; frequency: number }>>`
        SELECT t.id, t.slug, count(*)::int AS frequency
        FROM participants p
        JOIN events e ON e.id = p."eventId"
        JOIN event_tags et ON et."eventId" = e.id
        JOIN tags t ON t.id = et."tagId"
        WHERE e."clientId" = ${clientId} AND ${predicate}
        GROUP BY t.id, t.slug
        ORDER BY frequency DESC
        LIMIT 5
      `,
    ]);

    const s = summaryRows[0];
    if (!s || s.events_count === 0) throw new NotFoundException(`Person not found: ${key}`);

    return {
      key,
      displayName: s.display_name,
      email: s.email,
      external: s.external_id ? { source: s.external_source, id: s.external_id } : null,
      eventsCount: s.events_count,
      firstSeen: s.first_seen,
      lastSeen: s.last_seen,
      checkedInCount: s.checked_in_count,
      noShowCount: s.no_show_count,
      segment: s.segment,
      history: historyRows.map((h) => ({
        eventId: h.event_id,
        title: h.title,
        startTime: h.start_time,
        status: h.status,
        checkedIn: h.checked_in,
      })),
      topCategories: topCategories.map((c) => ({
        id: c.category_id,
        name: c.name,
        frequency: c.frequency,
      })),
      topTags: topTags.map((t) => ({ id: t.id, slug: t.slug, frequency: t.frequency })),
    };
  }
}
