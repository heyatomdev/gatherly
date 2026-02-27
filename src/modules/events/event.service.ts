import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { rrulestr } from 'rrule';

@Injectable()
export class EventService {
  constructor(private prisma: PrismaService) {}

  async createEvent(
    clientId: string,
    data: {
      title: string;
      description?: string;
      authorId: string;
      authorName: string;
      authorEmail?: string;
      startTime: Date;
      endTime?: Date;
      timezone?: string;
      status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
      type?: string;
      coverImageUrl?: string;
      tags?: string[];
      categoryId?: string;
      locationName?: string;
      locationAddress?: string;
      locationUrl?: string;
      isOnline?: boolean;
      maxParticipants?: number;
      isPublic?: boolean;
      price?: number;
      currency?: string;
      recurrenceRule?: string;
      recurrenceEndDate?: Date;
      recurrenceCount?: number;
    },
  ) {
    const event = await this.prisma.event.create({
      data: {
        ...data,
        clientId,
        isRecurring: !!data.recurrenceRule,
      },
      include: {
        participants: true,
        category: true,
      },
    });

    // Se è ricorrente, genera le istanze future
    if (data.recurrenceRule) {
      await this.generateRecurringInstances(event);
    }

    return event;
  }

  private async generateRecurringInstances(parentEvent: any) {
    try {
      const rrule = rrulestr(parentEvent.recurrenceRule, {
        dtstart: parentEvent.startTime
      });

      // Determina il limite per le occorrenze
      const maxOccurrences = parentEvent.recurrenceCount || 52; // Default 1 anno
      const endDate = parentEvent.recurrenceEndDate;

      let occurrences = rrule.all((_, count) => count < maxOccurrences);

      // Filtra per data di fine se specificata
      if (endDate) {
        occurrences = occurrences.filter(date => date <= endDate);
      }

      // Calcola la durata dell'evento se ha endTime
      let duration: number | null = null;
      if (parentEvent.endTime) {
        duration = parentEvent.endTime.getTime() - parentEvent.startTime.getTime();
      }

      for (const occurrence of occurrences) {
        if (occurrence > new Date()) {
          const eventEndTime = duration
            ? new Date(occurrence.getTime() + duration)
            : null;

          await this.prisma.event.create({
            data: {
              title: parentEvent.title,
              description: parentEvent.description,
              clientId: parentEvent.clientId,
              authorId: parentEvent.authorId,
              authorName: parentEvent.authorName,
              authorEmail: parentEvent.authorEmail,
              startTime: occurrence,
              endTime: eventEndTime,
              timezone: parentEvent.timezone,
              status: parentEvent.status,
              type: parentEvent.type,
              coverImageUrl: parentEvent.coverImageUrl,
              tags: parentEvent.tags,
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
              isRecurring: false,
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
      isOnline?: boolean;
      fromDate?: Date;
      toDate?: Date;
    }
  ) {
    return this.prisma.event.findMany({
      where: {
        clientId,
        ...(filters?.status && { status: filters.status }),
        ...(filters?.type && { type: filters.type }),
        ...(filters?.categoryId && { categoryId: filters.categoryId }),
        ...(filters?.isOnline !== undefined && { isOnline: filters.isOnline }),
        ...(filters?.fromDate && {
          startTime: { gte: filters.fromDate }
        }),
        ...(filters?.toDate && {
          startTime: { lte: filters.toDate }
        }),
      },
      include: {
        participants: true,
        category: true,
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async getEventById(eventId: string, clientId: string) {
    return this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      include: {
        participants: {
          orderBy: { createdAt: 'asc' }
        },
        category: true,
        childEvents: {
          include: {
            participants: true
          }
        }
      },
    });
  }

  async addParticipant(
    eventId: string,
    clientId: string,
    participantData: {
      userId: string;
      userName: string;
      role?: 'ATTENDEE' | 'SPEAKER' | 'ORGANIZER' | 'HOST';
      notes?: string;
    },
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      include: {
        participants: {
          where: {
            status: { in: ['REGISTERED', 'CONFIRMED'] }
          }
        }
      }
    });

    if (!event) {
      throw new Error('Evento non trovato');
    }

    // Verifica capacità massima e gestisci waitlist
    let participantStatus: 'REGISTERED' | 'WAITLIST' = 'REGISTERED';

    if (event.maxParticipants) {
      const currentCount = event.participants.length;
      if (currentCount >= event.maxParticipants) {
        participantStatus = 'WAITLIST';
      }
    }

    return this.prisma.participant.create({
      data: {
        eventId,
        userId: participantData.userId,
        userName: participantData.userName,
        status: participantStatus,
        role: participantData.role || 'ATTENDEE',
        notes: participantData.notes,
      },
    });
  }

  async removeParticipant(eventId: string, clientId: string, userId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
    });

    if (!event) {
      throw new Error('Evento non trovato');
    }

    // Segna il partecipante come CANCELLED invece di eliminarlo
    const result = await this.prisma.participant.updateMany({
      where: {
        eventId,
        userId,
      },
      data: {
        status: 'CANCELLED',
      },
    });

    // Gestisci la waitlist: promuovi il primo in attesa
    if (event.maxParticipants) {
      await this.promoteFromWaitlist(eventId);
    }

    return result;
  }

  // Promuove il primo partecipante dalla waitlist
  private async promoteFromWaitlist(eventId: string) {
    const firstWaitlisted = await this.prisma.participant.findFirst({
      where: {
        eventId,
        status: 'WAITLIST',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (firstWaitlisted) {
      await this.prisma.participant.update({
        where: { id: firstWaitlisted.id },
        data: { status: 'REGISTERED' },
      });
    }
  }

  async updateEvent(
    eventId: string,
    clientId: string,
    data: Partial<{
      title: string;
      description: string;
      startTime: Date;
      endTime: Date;
      timezone: string;
      status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
      type: string;
      coverImageUrl: string;
      tags: string[];
      categoryId: string;
      locationName: string;
      locationAddress: string;
      locationUrl: string;
      isOnline: boolean;
      maxParticipants: number;
      isPublic: boolean;
      price: number;
      currency: string;
    }>,
  ) {
    return this.prisma.event.updateMany({
      where: { id: eventId, clientId },
      data,
    });
  }

  async updateParticipantStatus(
    participantId: string,
    eventId: string,
    clientId: string,
    status: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED',
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
    });

    if (!event) {
      throw new Error('Evento non trovato');
    }

    const result = await this.prisma.participant.updateMany({
      where: {
        id: participantId,
        eventId,
      },
      data: { status },
    });

    // Se un partecipante viene cancellato, promuovi dalla waitlist
    if (status === 'CANCELLED' && event.maxParticipants) {
      await this.promoteFromWaitlist(eventId);
    }

    return result;
  }

  async checkInParticipant(
    participantId: string,
    eventId: string,
    clientId: string,
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
    });

    if (!event) {
      throw new Error('Evento non trovato');
    }

    return this.prisma.participant.updateMany({
      where: {
        id: participantId,
        eventId,
      },
      data: {
        checkedIn: true,
        checkedInAt: new Date(),
        status: 'ATTENDED',
      },
    });
  }

  async completeEvent(eventId: string, clientId: string) {
    return this.prisma.event.updateMany({
      where: { id: eventId, clientId },
      data: { status: 'COMPLETED' },
    });
  }

  async getEventStats(eventId: string, clientId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, clientId },
      include: {
        participants: true,
      },
    });

    if (!event) {
      throw new Error('Evento non trovato');
    }

    const stats = {
      totalParticipants: event.participants.length,
      registered: event.participants.filter(p => p.status === 'REGISTERED').length,
      confirmed: event.participants.filter(p => p.status === 'CONFIRMED').length,
      waitlist: event.participants.filter(p => p.status === 'WAITLIST').length,
      cancelled: event.participants.filter(p => p.status === 'CANCELLED').length,
      attended: event.participants.filter(p => p.status === 'ATTENDED').length,
      checkedIn: event.participants.filter(p => p.checkedIn).length,
      availableSpots: event.maxParticipants
        ? Math.max(0, event.maxParticipants - event.participants.filter(p => p.status === 'REGISTERED' || p.status === 'CONFIRMED').length)
        : null,
    };

    return { event, stats };
  }

  // Cron job per pulire eventi passati
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupPastEvents() {
    await this.prisma.event.deleteMany({
      where: {
        startTime: {
          lt: new Date(),
        },
        parentEventId: {
          not: null,
        },
      },
    });
  }
}

