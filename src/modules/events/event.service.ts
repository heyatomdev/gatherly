import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { rrulestr } from 'rrule';
import { CreateEventDto, UpdateEventDto, AddParticipantDto } from './dto/event.dto';

const EVENT_INCLUDE = {
  translations: true,
  tags: { include: { tag: true } },
  participants: true,
  category: { include: { translations: true } },
  recurrenceRule: true,
};

@Injectable()
export class EventService {
  constructor(private prisma: PrismaService) {}

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

    return event;
  }

  private async generateRecurringInstances(parentEvent: any) {
    try {
      const rule = parentEvent.recurrenceRule;
      if (!rule) return;

      const rrule = rrulestr(rule.rule, { dtstart: parentEvent.startTime });
      const maxOccurrences = rule.count ?? 52;
      const endDate = rule.endDate;

      let occurrences = rrule.all((_, count) => count < maxOccurrences);
      if (endDate) occurrences = occurrences.filter((d) => d <= endDate);

      const duration = parentEvent.endTime
        ? parentEvent.endTime.getTime() - parentEvent.startTime.getTime()
        : null;

      for (const occurrence of occurrences) {
        if (occurrence > new Date()) {
          await this.prisma.event.create({
            data: {
              clientId: parentEvent.clientId,
              defaultLocale: parentEvent.defaultLocale,
              authorId: parentEvent.authorId,
              authorName: parentEvent.authorName,
              authorEmail: parentEvent.authorEmail,
              startTime: occurrence,
              endTime: duration ? new Date(occurrence.getTime() + duration) : undefined,
              timezone: parentEvent.timezone,
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
              translations: {
                create: parentEvent.translations.map((t: any) => ({
                  locale: t.locale,
                  title: t.title,
                  description: t.description,
                })),
              },
              tags: {
                create: parentEvent.tags.map((et: any) => ({ tagId: et.tagId })),
              },
            },
          });
        }
      }
    } catch (error) {
      console.error('Errore nella generazione ricorrenze:', error);
    }
  }

  async getEventsByClient(
    clientId: string,
    filters?: {
      status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
      type?: string;
      categoryId?: string;
      tagId?: string;
      isOnline?: boolean;
      fromDate?: Date;
      toDate?: Date;
    },
  ) {
    return this.prisma.event.findMany({
      where: {
        clientId,
        ...(filters?.status && { status: filters.status }),
        ...(filters?.type && { type: filters.type }),
        ...(filters?.categoryId && { categoryId: filters.categoryId }),
        ...(filters?.tagId && { tags: { some: { tagId: filters.tagId } } }),
        ...(filters?.isOnline !== undefined && { isOnline: filters.isOnline }),
        ...(filters?.fromDate && { startTime: { gte: filters.fromDate } }),
        ...(filters?.toDate && { startTime: { lte: filters.toDate } }),
      },
      include: EVENT_INCLUDE,
      orderBy: { startTime: 'asc' },
    });
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

    if (data.translations?.length) {
      await Promise.all(
        data.translations.map((t) =>
          this.prisma.eventTranslation.upsert({
            where: { eventId_locale: { eventId, locale: t.locale } },
            create: { eventId, locale: t.locale, title: t.title, description: t.description },
            update: { title: t.title, description: t.description },
          }),
        ),
      );
    }

    if (data.tagSlugs !== undefined) {
      const tagIds = await this.resolveTagSlugs(clientId, data.tagSlugs);
      await this.prisma.eventTag.deleteMany({ where: { eventId } });
      if (tagIds.length) {
        await this.prisma.eventTag.createMany({
          data: tagIds.map((tagId) => ({ eventId, tagId })),
        });
      }
    }

    const { translations, tagSlugs, ...scalarData } = data;

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

  async addParticipant(eventId: string, clientId: string, data: AddParticipantDto) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      include: {
        participants: { where: { status: { in: ['REGISTERED', 'CONFIRMED'] } } },
      },
    });

    if (!event) throw new NotFoundException('Event not found');

    let participantStatus: 'REGISTERED' | 'WAITLIST' = 'REGISTERED';
    if (event.maxParticipants && event.participants.length >= event.maxParticipants) {
      participantStatus = 'WAITLIST';
    }

    return this.prisma.participant.create({
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
  }

  async removeParticipant(eventId: string, clientId: string, participantId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, clientId } });
    if (!event) throw new NotFoundException('Event not found');

    await this.prisma.participant.update({
      where: { id: participantId },
      data: { status: 'CANCELLED' },
    });

    if (event.maxParticipants) {
      await this.promoteFromWaitlist(eventId);
    }
  }

  async updateParticipantStatus(
    participantId: string,
    eventId: string,
    clientId: string,
    status: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED',
  ) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, clientId } });
    if (!event) throw new NotFoundException('Event not found');

    const result = await this.prisma.participant.update({
      where: { id: participantId },
      data: { status },
    });

    if (status === 'CANCELLED' && event.maxParticipants) {
      await this.promoteFromWaitlist(eventId);
    }

    return result;
  }

  async checkInParticipant(participantId: string, eventId: string, clientId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, clientId } });
    if (!event) throw new NotFoundException('Event not found');

    return this.prisma.participant.update({
      where: { id: participantId },
      data: { checkedIn: true, checkedInAt: new Date(), status: 'ATTENDED' },
    });
  }

  async completeEvent(eventId: string, clientId: string) {
    await this.getEventById(eventId, clientId);
    return this.prisma.event.update({
      where: { id: eventId },
      data: { status: 'COMPLETED' },
      include: EVENT_INCLUDE,
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

  private async promoteFromWaitlist(eventId: string) {
    const first = await this.prisma.participant.findFirst({
      where: { eventId, status: 'WAITLIST' },
      orderBy: { createdAt: 'asc' },
    });

    if (first) {
      await this.prisma.participant.update({
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
    await this.prisma.event.deleteMany({
      where: {
        startTime: { lt: new Date() },
        parentEventId: { not: null },
      },
    });
  }
}
