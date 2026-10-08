import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { RRule, Options as RRuleOptions } from 'rrule';
import { PrismaService } from '../prisma/prisma.service';
import { BastionAuditService } from '@heyatom/bastion-client/nest';
import { WebhookService } from '../webhook/webhook.service';
import { WebhookEventType } from '../webhook/dto/webhook-event.dto';
import {
  CreateEventDto,
  UpdateEventDto,
  AddParticipantDto,
  GetEventsQueryDto,
  GetParticipantsQueryDto,
  BulkAddParticipantsDto,
} from './dto/event.dto';
import { PageParams, PaginatedResult, paginate } from '@/common/pagination';

/** Statuses that take a seat against maxParticipants. */
const ACTIVE_STATUSES: ('REGISTERED' | 'CONFIRMED')[] = ['REGISTERED', 'CONFIRMED'];

/** Seats taken, instead of loading every participant row. */
const ACTIVE_COUNT = {
  _count: { select: { participants: { where: { status: { in: ACTIVE_STATUSES } } } } },
} as const;

/** Event detail without participants — also the shape webhook payloads are built from. */
const EVENT_INCLUDE = {
  translations: true,
  tags: { include: { tag: true } },
  category: { include: { translations: true } },
  recurrenceRule: true,
} as const;

/** Recurring children returned inline by GET /events/:id. */
const MAX_CHILD_EVENTS = 100;

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['CANCELLED', 'COMPLETED'],
  CANCELLED: [],
  COMPLETED: [],
};

const DAY = '([+-]?\\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)';
const INTS = (n: number) => `[+-]?\\d{1,${n}}(,[+-]?\\d{1,${n}})*`;
// Strict per-part grammar: rrule happily accepts junk like INTERVAL=abc and then loops forever.
const RRULE_PARTS = new Map<string, RegExp>(Object.entries({
  FREQ: /^(DAILY|WEEKLY|MONTHLY|YEARLY)$/,
  INTERVAL: /^[1-9]\d{0,2}$/,
  COUNT: /^[1-9]\d{0,2}$/,
  UNTIL: /^\d{8}(T\d{6}Z?)?$/,
  BYDAY: new RegExp(`^${DAY}(,${DAY})*$`),
  BYMONTH: new RegExp(`^${INTS(2)}$`),
  BYMONTHDAY: new RegExp(`^${INTS(2)}$`),
  BYSETPOS: new RegExp(`^${INTS(3)}$`),
  WKST: /^(MO|TU|WE|TH|FR|SA|SU)$/,
}));
const RECURRENCE_WINDOW_MS = 2 * 365 * 24 * 60 * 60 * 1000;

/** Validates an RRULE string and returns its options. Throws 400 on anything unexpected. */
export function parseRecurrenceRule(rule: string): Partial<RRuleOptions> {
  const body = rule.trim().toUpperCase().replace(/^RRULE:/, '');
  const parts = body.split(';');
  const keys = parts.map((part) => {
    const [key, value, ...rest] = part.split('=');
    if (rest.length || !RRULE_PARTS.get(key)?.test(value ?? '')) {
      throw new BadRequestException(`Invalid recurrenceRule part: ${part.slice(0, 50)}`);
    }
    return key;
  });
  if (!keys.includes('FREQ') || new Set(keys).size !== keys.length) {
    throw new BadRequestException('recurrenceRule needs exactly one FREQ and no repeated parts');
  }
  try {
    const options = RRule.parseString(body);
    const now = new Date();
    new RRule({ ...options, dtstart: now }).between(
      now,
      new Date(now.getTime() + RECURRENCE_WINDOW_MS),
      true,
      (_, i) => i < 1,
    );
    return options;
  } catch {
    throw new BadRequestException('Invalid recurrenceRule');
  }
}

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    private prisma: PrismaService,
    private audit: BastionAuditService,
    private webhook: WebhookService,
  ) {}

  /** Fire-and-forget: a webhook failure never breaks the main operation. */
  private emit(clientId: string, type: WebhookEventType, items: any, extra?: Record<string, unknown>) {
    this.webhook
      .notify(clientId, type, items, extra)
      .catch((err) => this.logger.warn(`webhook ${type} enqueue failed: ${err?.message}`));
  }

  /**
   * Locks the event row for the rest of the transaction, so concurrent
   * capacity checks on the same event serialize instead of overbooking.
   */
  private async lockEvent(tx: Prisma.TransactionClient, eventId: string, clientId: string) {
    const [event] = await tx.$queryRaw<{ id: string; maxParticipants: number | null }[]>`
      SELECT id, "maxParticipants" FROM events
       WHERE id = ${eventId} AND "clientId" = ${clientId}
         FOR UPDATE
    `;
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  private countActive(tx: Prisma.TransactionClient, eventId: string) {
    return tx.participant.count({ where: { eventId, status: { in: ACTIVE_STATUSES } } });
  }

  private async assertCategory(clientId: string, categoryId?: string | null) {
    if (!categoryId) return;
    const category = await this.prisma.eventCategory.findFirst({
      where: { id: categoryId, clientId },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Category not found');
  }

  private async findStatus(eventId: string, clientId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      select: { status: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event.status;
  }

  private assertTransition(from: string, to: string) {
    if (!VALID_TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(`Cannot transition event from ${from} to ${to}`);
    }
  }

  async createEvent(clientId: string, data: CreateEventDto) {
    if (data.recurrenceRule) parseRecurrenceRule(data.recurrenceRule);
    await this.assertCategory(clientId, data.categoryId);

    const event = await this.prisma.$transaction(async (tx) => {
      let recurrenceRuleId: string | undefined;
      if (data.recurrenceRule) {
        const rule = await tx.recurrenceRule.create({
          data: {
            rule: data.recurrenceRule,
            endDate: data.recurrenceEndDate ? new Date(data.recurrenceEndDate) : undefined,
            count: data.recurrenceCount,
          },
        });
        recurrenceRuleId = rule.id;
      }

      const tagIds = await this.resolveTagSlugs(tx, clientId, data.tagSlugs);

      const created = await tx.event.create({
        data: {
          clientId,
          defaultLocale: data.defaultLocale ?? data.translations[0]?.locale ?? 'it',
          authorId: data.authorId,
          authorName: data.authorName,
          authorEmail: data.authorEmail,
          startTime: new Date(data.startTime),
          endTime: data.endTime ? new Date(data.endTime) : undefined,
          timezone: data.timezone,
          status: data.status,
          type: data.type,
          coverImageUrl: data.coverImageUrl,
          categoryId: data.categoryId,
          locationName: data.locationName,
          locationAddress: data.locationAddress,
          locationUrl: data.locationUrl,
          isOnline: data.isOnline,
          maxParticipants: data.maxParticipants,
          isPublic: data.isPublic,
          price: data.price,
          currency: data.currency,
          recurrenceRuleId,
          translations: { create: data.translations },
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        },
        include: EVENT_INCLUDE,
      });

      if (recurrenceRuleId) await this.generateRecurringInstances(tx, created);
      return created;
    });

    this.audit.write('event.created', { metadata: { eventId: event.id, clientId } });
    this.emit(clientId, WebhookEventType.EVENT_CREATED, event);

    return event;
  }

  private async generateRecurringInstances(tx: Prisma.TransactionClient, parentEvent: any) {
    const rule = parentEvent.recurrenceRule;
    if (!rule) return;

    const tz = parentEvent.timezone ?? 'UTC';

    const dtstart = DateTime.fromJSDate(parentEvent.startTime, { zone: 'utc' })
      .setZone(tz)
      .toJSDate();

    const rrule = new RRule({ ...parseRecurrenceRule(rule.rule), dtstart, tzid: tz });
    const maxOccurrences = rule.count ?? 52;
    const windowEnd = new Date(dtstart.getTime() + RECURRENCE_WINDOW_MS);
    const until = rule.endDate && rule.endDate < windowEnd ? rule.endDate : windowEnd;

    const occurrences = rrule
      .between(dtstart, until, true, (_, i) => i < maxOccurrences)
      .filter((d) => d.getTime() !== parentEvent.startTime.getTime());

    const duration = parentEvent.endTime
      ? parentEvent.endTime.getTime() - parentEvent.startTime.getTime()
      : null;

    const futureOccurrences = occurrences.filter((o) => o > new Date());
    if (!futureOccurrences.length) return;

    const eventIds = futureOccurrences.map(() => randomUUID());

    await tx.event.createMany({
        data: futureOccurrences.map((occurrence, i) => ({
          id: eventIds[i],
          clientId: parentEvent.clientId,
          defaultLocale: parentEvent.defaultLocale,
          authorId: parentEvent.authorId,
          authorName: parentEvent.authorName,
          authorEmail: parentEvent.authorEmail,
          startTime: occurrence,
          endTime: duration ? new Date(occurrence.getTime() + duration) : undefined,
          timezone: tz,
          status: parentEvent.status,
          type: parentEvent.type,
          coverImageUrl: parentEvent.coverImageUrl,
          categoryId: parentEvent.categoryId,
          locationName: parentEvent.locationName,
          locationAddress: parentEvent.locationAddress,
          locationUrl: parentEvent.locationUrl,
          isOnline: parentEvent.isOnline,
          maxParticipants: parentEvent.maxParticipants,
          isPublic: parentEvent.isPublic,
          price: parentEvent.price,
          currency: parentEvent.currency,
          parentEventId: parentEvent.id,
          recurrenceRuleId: parentEvent.recurrenceRuleId,
        })),
      });

      const translationData = eventIds.flatMap((eventId) =>
        parentEvent.translations.map((t: any) => ({
          eventId,
          locale: t.locale,
          title: t.title,
          description: t.description ?? null,
        })),
      );
      if (translationData.length) {
        await tx.eventTranslation.createMany({ data: translationData });
      }

      const tagData = eventIds.flatMap((eventId) =>
        parentEvent.tags.map((et: any) => ({ eventId, tagId: et.tagId })),
      );
      if (tagData.length) {
        await tx.eventTag.createMany({ data: tagData });
      }
  }

  async getEventsByClient(
    clientId: string,
    filters: GetEventsQueryDto,
  ): Promise<PaginatedResult<any>> {
    const where: Prisma.EventWhereInput = {
      clientId,
      ...(filters.status && { status: filters.status }),
      ...(filters.type && { type: filters.type }),
      ...(filters.categoryId && { categoryId: filters.categoryId }),
      ...(filters.tagId && { tags: { some: { tagId: filters.tagId } } }),
      ...(filters.isOnline !== undefined && { isOnline: filters.isOnline }),
      ...((filters.fromDate || filters.toDate) && {
        startTime: {
          ...(filters.fromDate && { gte: new Date(filters.fromDate) }),
          ...(filters.toDate && { lte: new Date(filters.toDate) }),
        },
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        include: { ...EVENT_INCLUDE, ...ACTIVE_COUNT },
        orderBy: { startTime: 'asc' },
        skip: filters.skip,
        take: filters.limit,
      }),
      this.prisma.event.count({ where }),
    ]);

    return paginate(data, total, filters);
  }

  async getEventById(eventId: string, clientId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      include: {
        ...EVENT_INCLUDE,
        ...ACTIVE_COUNT,
        childEvents: {
          select: { id: true, startTime: true, status: true, ...ACTIVE_COUNT },
          orderBy: { startTime: 'asc' },
          take: MAX_CHILD_EVENTS,
        },
      },
    });

    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async updateEvent(eventId: string, clientId: string, data: UpdateEventDto) {
    const { translations, tagSlugs, ...scalarData } = data;

    const status = await this.findStatus(eventId, clientId);
    if (scalarData.status) this.assertTransition(status, scalarData.status);
    await this.assertCategory(clientId, scalarData.categoryId);

    const event = await this.prisma.$transaction(async (tx) => {
      for (const t of translations ?? []) {
        await tx.eventTranslation.upsert({
          where: { eventId_locale: { eventId, locale: t.locale } },
          create: { eventId, locale: t.locale, title: t.title, description: t.description },
          update: { title: t.title, description: t.description },
        });
      }

      if (tagSlugs !== undefined) {
        const tagIds = await this.resolveTagSlugs(tx, clientId, tagSlugs);
        await tx.eventTag.deleteMany({ where: { eventId } });
        if (tagIds.length) {
          await tx.eventTag.createMany({ data: tagIds.map((tagId) => ({ eventId, tagId })) });
        }
      }

      return tx.event.update({
        where: { id: eventId },
        data: {
          ...scalarData,
          startTime: scalarData.startTime ? new Date(scalarData.startTime) : undefined,
          endTime: scalarData.endTime ? new Date(scalarData.endTime) : undefined,
        },
        include: EVENT_INCLUDE,
      });
    });

    this.emit(clientId, WebhookEventType.EVENT_UPDATED, event);
    return event;
  }

  async cancelEvent(eventId: string, clientId: string) {
    this.assertTransition(await this.findStatus(eventId, clientId), 'CANCELLED');

    const updated = await this.prisma.$transaction(async (tx) => {
      const event = await tx.event.update({
        where: { id: eventId },
        data: { status: 'CANCELLED' },
        include: EVENT_INCLUDE,
      });
      await tx.event.updateMany({
        where: {
          parentEventId: eventId,
          startTime: { gt: new Date() },
          status: { notIn: ['CANCELLED', 'COMPLETED'] },
        },
        data: { status: 'CANCELLED' },
      });
      return event;
    });

    this.audit.write('event.cancelled', { metadata: { eventId, clientId } });
    this.emit(clientId, WebhookEventType.EVENT_CANCELLED, updated);

    return updated;
  }

  async publishEvent(eventId: string, clientId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      select: { status: true, startTime: true, translations: { select: { title: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');

    this.assertTransition(event.status, 'PUBLISHED');

    if (!event.translations.length || !event.translations[0].title?.trim()) {
      throw new BadRequestException('Event must have at least one translation with a title');
    }
    if (event.startTime <= new Date()) {
      throw new BadRequestException('Cannot publish an event with a start time in the past');
    }

    const published = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: 'PUBLISHED' },
      include: EVENT_INCLUDE,
    });

    this.audit.write('event.published', { metadata: { eventId, clientId } });
    this.emit(clientId, WebhookEventType.EVENT_PUBLISHED, published);

    return published;
  }

  async completeEvent(eventId: string, clientId: string) {
    this.assertTransition(await this.findStatus(eventId, clientId), 'COMPLETED');

    const completed = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: 'COMPLETED' },
      include: EVENT_INCLUDE,
    });

    this.audit.write('event.completed', { metadata: { eventId, clientId } });
    this.emit(clientId, WebhookEventType.EVENT_COMPLETED, completed);

    return completed;
  }

  async getParticipants(
    eventId: string,
    clientId: string,
    query: GetParticipantsQueryDto,
  ): Promise<PaginatedResult<any>> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    const where: Prisma.ParticipantWhereInput = {
      eventId,
      ...(query.status && { status: query.status as any }),
      ...(query.role && { role: query.role as any }),
      ...(query.externalSource && { externalSource: query.externalSource }),
      ...(query.externalId && { externalId: query.externalId }),
      ...(query.checkedIn !== undefined && { checkedIn: query.checkedIn }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.participant.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.participant.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async addParticipant(eventId: string, clientId: string, data: AddParticipantDto) {
    try {
      const participant = await this.prisma.$transaction(async (tx) => {
        const event = await this.lockEvent(tx, eventId, clientId);
        const full =
          event.maxParticipants != null &&
          (await this.countActive(tx, eventId)) >= event.maxParticipants;

        return tx.participant.create({
          data: {
            eventId,
            type: data.type ?? 'INLINE',
            userName: data.userName,
            email: data.email,
            externalId: data.externalId,
            externalSource: data.externalSource,
            status: full ? 'WAITLIST' : 'REGISTERED',
            role: data.role ?? 'ATTENDEE',
            notes: data.notes,
            metadata: data.metadata,
          },
        });
      });

      this.audit.write('participant.joined', {
        metadata: { eventId, clientId, participantId: participant.id },
      });
      this.emit(clientId, WebhookEventType.PARTICIPANT_JOINED, participant);

      return participant;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Participant already registered for this event');
      }
      throw error;
    }
  }

  async addParticipantsBulk(
    eventId: string,
    clientId: string,
    data: BulkAddParticipantsDto,
  ): Promise<{ added: number; waitlisted: number; skipped: number; errors: Array<{ index: number; reason: string }> }> {
    const result = { added: 0, waitlisted: 0, skipped: 0, errors: [] as Array<{ index: number; reason: string }> };

    const created = await this.prisma.$transaction(async (tx) => {
      const event = await this.lockEvent(tx, eventId, clientId);
      let activeCount = await this.countActive(tx, eventId);

      // The unique key is (eventId, externalId, externalSource): dedupe against
      // existing rows and within the batch up front, so createMany can't hit P2002.
      const key = (id: string, source: string) => `${source}\u0000${id}`;
      const externalIds = data.participants
        .filter((p) => p.externalId && p.externalSource)
        .map((p) => p.externalId!);
      const existing = externalIds.length
        ? await tx.participant.findMany({
            where: { eventId, externalId: { in: externalIds } },
            select: { externalId: true, externalSource: true },
          })
        : [];
      const taken = new Set(existing.map((p) => key(p.externalId!, p.externalSource!)));

      const rows: Prisma.ParticipantCreateManyInput[] = [];
      data.participants.forEach((p, index) => {
        if (p.externalId && p.externalSource) {
          const k = key(p.externalId, p.externalSource);
          if (taken.has(k)) {
            if (data.skipDuplicates) result.skipped++;
            else result.errors.push({ index, reason: 'Already registered' });
            return;
          }
          taken.add(k);
        }

        const full = event.maxParticipants != null && activeCount >= event.maxParticipants;
        if (full) result.waitlisted++;
        else { result.added++; activeCount++; }

        rows.push({
          eventId,
          type: p.type ?? 'INLINE',
          userName: p.userName,
          email: p.email,
          externalId: p.externalId,
          externalSource: p.externalSource,
          status: full ? 'WAITLIST' : 'REGISTERED',
          role: p.role ?? 'ATTENDEE',
          notes: p.notes,
          metadata: p.metadata,
        });
      });

      return rows.length ? tx.participant.createManyAndReturn({ data: rows }) : [];
    });

    this.emit(clientId, WebhookEventType.PARTICIPANT_JOINED, created);
    return result;
  }

  async removeParticipant(eventId: string, clientId: string, participantId: string) {
    const { participant, promoted } = await this.prisma.$transaction(async (tx) => {
      const event = await this.lockEvent(tx, eventId, clientId);

      const existing = await tx.participant.findFirst({
        where: { id: participantId, eventId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Participant not found');

      const participant = await tx.participant.update({
        where: { id: participantId },
        data: { status: 'CANCELLED' },
      });
      const promoted = await this.promoteFromWaitlistTx(tx, eventId, event.maxParticipants);
      return { participant, promoted };
    });

    this.audit.write('participant.removed', { metadata: { eventId, clientId, participantId } });
    this.emit(clientId, WebhookEventType.PARTICIPANT_REMOVED, participant);
    this.emitPromoted(clientId, promoted);
  }

  async updateParticipantStatus(
    participantId: string,
    eventId: string,
    clientId: string,
    status: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED',
  ) {
    const { result, previousStatus, promoted } = await this.prisma.$transaction(async (tx) => {
      const event = await this.lockEvent(tx, eventId, clientId);

      const participant = await tx.participant.findFirst({
        where: { id: participantId, eventId },
        select: { status: true },
      });
      if (!participant) throw new NotFoundException('Participant not found');

      const isActive = (s: string) => (ACTIVE_STATUSES as string[]).includes(s);
      if (
        isActive(status) &&
        !isActive(participant.status) &&
        event.maxParticipants != null &&
        (await this.countActive(tx, eventId)) >= event.maxParticipants
      ) {
        throw new ConflictException('Event is full');
      }

      const result = await tx.participant.update({
        where: { id: participantId },
        data: { status },
      });
      const promoted =
        status === 'CANCELLED'
          ? await this.promoteFromWaitlistTx(tx, eventId, event.maxParticipants)
          : null;
      return { result, previousStatus: participant.status, promoted };
    });

    if (previousStatus !== status) {
      this.emit(clientId, WebhookEventType.PARTICIPANT_STATUS_CHANGED, result, { previousStatus });
    }
    this.emitPromoted(clientId, promoted);
    return result;
  }

  async checkInParticipant(participantId: string, eventId: string, clientId: string) {
    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, eventId, event: { clientId } },
      select: { id: true },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    const checkedIn = await this.prisma.participant.update({
      where: { id: participantId },
      data: { checkedIn: true, checkedInAt: new Date(), status: 'ATTENDED' },
    });

    this.emit(clientId, WebhookEventType.PARTICIPANT_CHECKED_IN, checkedIn);
    return checkedIn;
  }

  async getEventStats(eventId: string, clientId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, clientId } });
    if (!event) throw new NotFoundException('Event not found');

    const [byStatus, checkedIn] = await Promise.all([
      this.prisma.participant.groupBy({
        by: ['status'],
        where: { eventId },
        _count: { _all: true },
      }),
      this.prisma.participant.count({ where: { eventId, checkedIn: true } }),
    ]);

    const count = (status: string) =>
      byStatus.find((g) => g.status === status)?._count._all ?? 0;
    const active = count('REGISTERED') + count('CONFIRMED');

    return {
      event,
      stats: {
        totalParticipants: byStatus.reduce((sum, g) => sum + g._count._all, 0),
        registered: count('REGISTERED'),
        confirmed: count('CONFIRMED'),
        waitlist: count('WAITLIST'),
        cancelled: count('CANCELLED'),
        attended: count('ATTENDED'),
        checkedIn,
        availableSpots: event.maxParticipants
          ? Math.max(0, event.maxParticipants - active)
          : null,
      },
    };
  }

  /** Caller must hold the event row lock (see lockEvent). */
  private async promoteFromWaitlistTx(
    tx: Prisma.TransactionClient,
    eventId: string,
    maxParticipants: number | null,
  ) {
    if (maxParticipants == null) return null;
    if ((await this.countActive(tx, eventId)) >= maxParticipants) return null;

    const first = await tx.participant.findFirst({
      where: { eventId, status: 'WAITLIST' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!first) return null;

    return tx.participant.update({
      where: { id: first.id },
      data: { status: 'REGISTERED' },
    });
  }

  private emitPromoted(clientId: string, promoted: { id: string } | null) {
    if (!promoted) return;
    this.emit(clientId, WebhookEventType.PARTICIPANT_STATUS_CHANGED, promoted, {
      previousStatus: 'WAITLIST',
    });
  }

  private async resolveTagSlugs(
    tx: Prisma.TransactionClient,
    clientId: string,
    slugs?: string[],
  ): Promise<string[]> {
    const unique = [...new Set((slugs ?? []).map((s) => s.toLowerCase()))];
    if (!unique.length) return [];

    await tx.tag.createMany({
      data: unique.map((slug) => ({ clientId, slug })),
      skipDuplicates: true,
    });
    const tags = await tx.tag.findMany({
      where: { clientId, slug: { in: unique } },
      select: { id: true },
    });
    return tags.map((t) => t.id);
  }

  /**
   * Marks past recurring children COMPLETED. Never deletes: participant
   * history backs analytics, People history and VIP/at-risk scoring.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupPastEvents() {
    await this.prisma.withAdvisoryLock('events.cleanupPastEvents', (tx) =>
      tx.event.updateMany({
        where: {
          parentEventId: { not: null },
          startTime: { lt: new Date() },
          status: { in: ['DRAFT', 'PUBLISHED'] },
        },
        data: { status: 'COMPLETED' },
      }),
    );
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredIdempotencyKeys() {
    await this.prisma.withAdvisoryLock('events.cleanupExpiredIdempotencyKeys', (tx) =>
      tx.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    );
  }
}
