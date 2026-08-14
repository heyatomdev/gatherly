import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { rrulestr } from 'rrule';
import { PrismaService } from '../prisma/prisma.service';
import { BastionAuditService } from '../bastion/bastion-audit.service';
import {
  CreateEventDto,
  UpdateEventDto,
  AddParticipantDto,
  GetEventsQueryDto,
  GetParticipantsQueryDto,
  BulkAddParticipantsDto,
} from './dto/event.dto';
import { PageParams, PaginatedResult, paginate } from '@/common/pagination';

const EVENT_INCLUDE = {
  translations: true,
  tags: { include: { tag: true } },
  participants: true,
  category: { include: { translations: true } },
  recurrenceRule: true,
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['CANCELLED', 'COMPLETED'],
  CANCELLED: [],
  COMPLETED: [],
};

const RETENTION_DAYS = 90;

@Injectable()
export class EventService {
  constructor(
    private prisma: PrismaService,
    private audit: BastionAuditService,
  ) {}

  private assertTransition(from: string, to: string) {
    if (!VALID_TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(`Cannot transition event from ${from} to ${to}`);
    }
  }

  async createEvent(clientId: string, data: CreateEventDto) {
    let recurrenceRuleId: string | undefined;
    if (data.recurrenceRule) {
      const rule = await this.prisma.recurrenceRule.create({
        data: {
          rule: data.recurrenceRule,
          endDate: data.recurrenceEndDate ? new Date(data.recurrenceEndDate) : undefined,
          count: data.recurrenceCount,
        },
      });
      recurrenceRuleId = rule.id;
    }

    const tagConnections = await this.resolveTagSlugs(clientId, data.tagSlugs);

    if (data.categoryId) {
      const category = await this.prisma.eventCategory.findFirst({
        where: { id: data.categoryId, clientId },
      });
      if (!category) throw new NotFoundException('Category not found');
    }

    const event = await this.prisma.event.create({
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
        tags: { create: tagConnections.map((tagId) => ({ tagId })) },
      },
      include: EVENT_INCLUDE,
    });

    if (recurrenceRuleId) {
      await this.generateRecurringInstances(event);
    }

    this.audit.write('event.created', { metadata: { eventId: event.id, clientId } });

    return event;
  }

  private async generateRecurringInstances(parentEvent: any) {
    const rule = parentEvent.recurrenceRule;
    if (!rule) return;

    const tz = parentEvent.timezone ?? 'UTC';

    const dtstart = DateTime.fromJSDate(parentEvent.startTime, { zone: 'utc' })
      .setZone(tz)
      .toJSDate();

    const rrule = rrulestr(rule.rule, { dtstart, tzid: tz });
    const maxOccurrences = rule.count ?? 52;
    const endDate = rule.endDate;

    let occurrences = rrule
      .all((_, count) => count < maxOccurrences)
      .filter((d) => d.getTime() !== parentEvent.startTime.getTime());

    if (endDate) occurrences = occurrences.filter((d) => d <= endDate);

    const duration = parentEvent.endTime
      ? parentEvent.endTime.getTime() - parentEvent.startTime.getTime()
      : null;

    const futureOccurrences = occurrences.filter((o) => o > new Date());
    if (!futureOccurrences.length) return;

    const eventIds = futureOccurrences.map(() => randomUUID());

    await this.prisma.$transaction(async (tx) => {
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
    });
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
      ...(filters.fromDate && { startTime: { gte: new Date(filters.fromDate) } }),
      ...(filters.toDate && { startTime: { lte: new Date(filters.toDate) } }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        include: EVENT_INCLUDE,
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
        childEvents: {
          include: { translations: true, participants: true },
        },
      },
    });

    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async updateEvent(eventId: string, clientId: string, data: UpdateEventDto) {
    await this.getEventById(eventId, clientId);

    const { translations, tagSlugs, ...scalarData } = data;

    if (scalarData.status) {
      const current = await this.prisma.event.findFirst({
        where: { id: eventId, clientId },
        select: { status: true },
      });
      this.assertTransition(current!.status, scalarData.status);
    }

    if (translations?.length) {
      await Promise.all(
        translations.map((t) =>
          this.prisma.eventTranslation.upsert({
            where: { eventId_locale: { eventId, locale: t.locale } },
            create: { eventId, locale: t.locale, title: t.title, description: t.description },
            update: { title: t.title, description: t.description },
          }),
        ),
      );
    }

    if (tagSlugs !== undefined) {
      const tagIds = await this.resolveTagSlugs(clientId, tagSlugs);
      await this.prisma.eventTag.deleteMany({ where: { eventId } });
      if (tagIds.length) {
        await this.prisma.eventTag.createMany({
          data: tagIds.map((tagId) => ({ eventId, tagId })),
        });
      }
    }

    if (scalarData.categoryId) {
      const category = await this.prisma.eventCategory.findFirst({
        where: { id: scalarData.categoryId, clientId },
      });
      if (!category) throw new NotFoundException('Category not found');
    }

    return this.prisma.event.update({
      where: { id: eventId },
      data: {
        ...scalarData,
        startTime: scalarData.startTime ? new Date(scalarData.startTime) : undefined,
        endTime: scalarData.endTime ? new Date(scalarData.endTime) : undefined,
      },
      include: EVENT_INCLUDE,
    });
  }

  async cancelEvent(eventId: string, clientId: string) {
    const event = await this.getEventById(eventId, clientId);
    this.assertTransition(event.status, 'CANCELLED');

    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: 'CANCELLED' },
      include: EVENT_INCLUDE,
    });

    await this.prisma.event.updateMany({
      where: {
        parentEventId: eventId,
        startTime: { gt: new Date() },
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
      data: { status: 'CANCELLED' },
    });

    this.audit.write('event.cancelled', { metadata: { eventId, clientId } });

    return updated;
  }

  async publishEvent(eventId: string, clientId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      include: { translations: true },
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

    return published;
  }

  async completeEvent(eventId: string, clientId: string) {
    const event = await this.getEventById(eventId, clientId);
    this.assertTransition(event.status, 'COMPLETED');

    const completed = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: 'COMPLETED' },
      include: EVENT_INCLUDE,
    });

    this.audit.write('event.completed', { metadata: { eventId, clientId } });

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
      const participant = await this.prisma.$transaction(
        async (tx) => {
          const event = await tx.event.findFirst({
            where: { id: eventId, clientId },
            include: {
              participants: { where: { status: { in: ['REGISTERED', 'CONFIRMED'] } } },
            },
          });

          if (!event) throw new NotFoundException('Event not found');

          const participantStatus: 'REGISTERED' | 'WAITLIST' =
            event.maxParticipants && event.participants.length >= event.maxParticipants
              ? 'WAITLIST'
              : 'REGISTERED';

          return tx.participant.create({
            data: {
              eventId,
              type: data.type ?? 'INLINE',
              userName: data.userName,
              email: data.email,
              externalId: data.externalId,
              externalSource: data.externalSource,
              status: participantStatus,
              role: data.role ?? 'ATTENDEE',
              notes: data.notes,
              metadata: data.metadata,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );

      this.audit.write('participant.joined', {
        metadata: { eventId, clientId, participantId: participant.id },
      });

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
    return this.prisma.$transaction(
      async (tx) => {
        const event = await tx.event.findFirst({
          where: { id: eventId, clientId },
          include: {
            participants: { where: { status: { in: ['REGISTERED', 'CONFIRMED'] } } },
          },
        });
        if (!event) throw new NotFoundException('Event not found');

        const result = { added: 0, waitlisted: 0, skipped: 0, errors: [] as Array<{ index: number; reason: string }> };
        let activeCount = event.participants.length;

        for (let i = 0; i < data.participants.length; i++) {
          const p = data.participants[i];
          try {
            if (p.type === 'EXTERNAL' && p.externalId && p.externalSource) {
              const exists = await tx.participant.findUnique({
                where: {
                  eventId_externalId_externalSource: {
                    eventId,
                    externalId: p.externalId,
                    externalSource: p.externalSource,
                  },
                },
              });
              if (exists) {
                if (data.skipDuplicates) { result.skipped++; continue; }
                result.errors.push({ index: i, reason: 'Already registered' });
                continue;
              }
            }

            const status: 'REGISTERED' | 'WAITLIST' =
              event.maxParticipants && activeCount >= event.maxParticipants
                ? 'WAITLIST'
                : 'REGISTERED';

            await tx.participant.create({
              data: {
                eventId,
                type: p.type ?? 'INLINE',
                userName: p.userName,
                email: p.email,
                externalId: p.externalId,
                externalSource: p.externalSource,
                status,
                role: p.role ?? 'ATTENDEE',
                notes: p.notes,
                metadata: p.metadata,
              },
            });

            if (status === 'REGISTERED') { result.added++; activeCount++; }
            else { result.waitlisted++; }
          } catch (error: any) {
            if (error.code === 'P2002') {
              if (data.skipDuplicates) { result.skipped++; }
              else { result.errors.push({ index: i, reason: 'Already registered' }); }
            } else {
              result.errors.push({ index: i, reason: error.message ?? 'Unknown error' });
            }
          }
        }

        return result;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async removeParticipant(eventId: string, clientId: string, participantId: string) {
    await this.prisma.$transaction(
      async (tx) => {
        const event = await tx.event.findFirst({
          where: { id: eventId, clientId },
          select: { id: true, maxParticipants: true },
        });
        if (!event) throw new NotFoundException('Event not found');

        const participant = await tx.participant.findFirst({
          where: { id: participantId, eventId },
        });
        if (!participant) throw new NotFoundException('Participant not found');

        await tx.participant.update({
          where: { id: participantId },
          data: { status: 'CANCELLED' },
        });

        if (event.maxParticipants) {
          await this.promoteFromWaitlistTx(tx, eventId, event.maxParticipants);
        }
      },
      { isolationLevel: 'Serializable' },
    );

    this.audit.write('participant.removed', { metadata: { eventId, clientId, participantId } });
  }

  async updateParticipantStatus(
    participantId: string,
    eventId: string,
    clientId: string,
    status: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED',
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      select: { id: true, maxParticipants: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    return this.prisma.$transaction(
      async (tx) => {
        const participant = await tx.participant.findFirst({
          where: { id: participantId, eventId },
        });
        if (!participant) throw new NotFoundException('Participant not found');

        const result = await tx.participant.update({
          where: { id: participantId },
          data: { status },
        });

        if (status === 'CANCELLED' && event.maxParticipants) {
          await this.promoteFromWaitlistTx(tx, eventId, event.maxParticipants);
        }

        return result;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async checkInParticipant(participantId: string, eventId: string, clientId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, clientId } });
    if (!event) throw new NotFoundException('Event not found');

    const participant = await this.prisma.participant.findFirst({
      where: { id: participantId, eventId },
    });
    if (!participant) throw new NotFoundException('Participant not found');

    return this.prisma.participant.update({
      where: { id: participantId },
      data: { checkedIn: true, checkedInAt: new Date(), status: 'ATTENDED' },
    });
  }

  async getEventStats(eventId: string, clientId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      include: { participants: true },
    });

    if (!event) throw new NotFoundException('Event not found');

    const active = event.participants.filter(
      (p) => p.status === 'REGISTERED' || p.status === 'CONFIRMED',
    ).length;

    return {
      event,
      stats: {
        totalParticipants: event.participants.length,
        registered: event.participants.filter((p) => p.status === 'REGISTERED').length,
        confirmed: event.participants.filter((p) => p.status === 'CONFIRMED').length,
        waitlist: event.participants.filter((p) => p.status === 'WAITLIST').length,
        cancelled: event.participants.filter((p) => p.status === 'CANCELLED').length,
        attended: event.participants.filter((p) => p.status === 'ATTENDED').length,
        checkedIn: event.participants.filter((p) => p.checkedIn).length,
        availableSpots: event.maxParticipants
          ? Math.max(0, event.maxParticipants - active)
          : null,
      },
    };
  }

  private async promoteFromWaitlistTx(
    tx: Prisma.TransactionClient,
    eventId: string,
    maxParticipants: number,
  ) {
    const active = await tx.participant.count({
      where: { eventId, status: { in: ['REGISTERED', 'CONFIRMED'] } },
    });

    if (active >= maxParticipants) return;

    const first = await tx.participant.findFirst({
      where: { eventId, status: 'WAITLIST' },
      orderBy: { createdAt: 'asc' },
    });

    if (first) {
      await tx.participant.update({
        where: { id: first.id },
        data: { status: 'REGISTERED' },
      });
    }
  }

  private async resolveTagSlugs(clientId: string, slugs?: string[]): Promise<string[]> {
    if (!slugs?.length) return [];

    const tags = await Promise.all(
      slugs.map((slug) =>
        this.prisma.tag.upsert({
          where: { clientId_slug: { clientId, slug: slug.toLowerCase() } },
          create: { clientId, slug: slug.toLowerCase() },
          update: {},
        }),
      ),
    );

    return tags.map((t) => t.id);
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupPastEvents() {
    const cutoff = new Date();

    await this.prisma.event.updateMany({
      where: {
        parentEventId: { not: null },
        startTime: { lt: cutoff },
        status: { in: ['DRAFT', 'PUBLISHED'] },
      },
      data: { status: 'COMPLETED' },
    });

    const retentionCutoff = new Date(cutoff.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.event.deleteMany({
      where: {
        parentEventId: { not: null },
        startTime: { lt: retentionCutoff },
        status: { in: ['COMPLETED', 'CANCELLED'] },
      },
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredIdempotencyKeys() {
    await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }
}
