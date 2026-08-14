import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventService } from './event.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { BastionAuditService } from '@/modules/bastion/bastion-audit.service';

// ── mock tx used inside $transaction callbacks ──────────────────────────────
const mockTx = {
  event: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    createMany: jest.fn(),
  },
  participant: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  eventTranslation: { createMany: jest.fn() },
  eventTag: { createMany: jest.fn() },
};

const mockPrisma = {
  event: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  participant: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  eventCategory: { findFirst: jest.fn() },
  recurrenceRule: { create: jest.fn() },
  tag: { upsert: jest.fn() },
  eventTag: { deleteMany: jest.fn(), createMany: jest.fn() },
  eventTranslation: { upsert: jest.fn() },
  idempotencyKey: { deleteMany: jest.fn() },
  webhookDelivery: { findMany: jest.fn() },
  $transaction: jest.fn().mockImplementation(async (arg: any, _opts?: any) => {
    if (typeof arg === 'function') return arg(mockTx);
    return Promise.all(arg.map((p: Promise<any>) => p));
  }),
};

const mockAudit = { write: jest.fn() };

const CLIENT_ID = 'client-1';
const EVENT_ID = 'event-1';
const PARTICIPANT_ID = 'participant-1';

function baseEvent(overrides: Record<string, any> = {}) {
  return {
    id: EVENT_ID,
    clientId: CLIENT_ID,
    status: 'DRAFT',
    startTime: new Date(Date.now() + 86_400_000),
    endTime: null,
    maxParticipants: null,
    translations: [{ locale: 'it', title: 'Evento', description: null }],
    tags: [],
    participants: [],
    category: null,
    recurrenceRule: null,
    ...overrides,
  };
}

function baseParticipant(overrides: Record<string, any> = {}) {
  return {
    id: PARTICIPANT_ID,
    eventId: EVENT_ID,
    type: 'INLINE',
    userName: 'Mario',
    email: 'mario@example.com',
    externalId: null,
    externalSource: null,
    status: 'REGISTERED',
    role: 'ATTENDEE',
    checkedIn: false,
    checkedInAt: null,
    notes: null,
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('EventService', () => {
  let service: EventService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EventService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BastionAuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get(EventService);
    jest.clearAllMocks();
    // restore default $transaction behaviour after clearAllMocks
    mockPrisma.$transaction.mockImplementation(async (arg: any, _opts?: any) => {
      if (typeof arg === 'function') return arg(mockTx);
      return Promise.all(arg.map((p: Promise<any>) => p));
    });
  });

  // ── State machine ──────────────────────────────────────────────────────────

  describe('cancelEvent', () => {
    it('transitions PUBLISHED → CANCELLED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ status: 'PUBLISHED' }));
      mockPrisma.event.update.mockResolvedValue(baseEvent({ status: 'CANCELLED' }));
      mockPrisma.event.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelEvent(EVENT_ID, CLIENT_ID)).resolves.toBeDefined();
      expect(mockPrisma.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
    });

    it('throws BadRequestException for CANCELLED → CANCELLED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ status: 'CANCELLED' }));

      await expect(service.cancelEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for COMPLETED → CANCELLED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ status: 'COMPLETED' }));

      await expect(service.cancelEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });
  });

  describe('publishEvent', () => {
    it('transitions DRAFT → PUBLISHED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ status: 'DRAFT' }));
      mockPrisma.event.update.mockResolvedValue(baseEvent({ status: 'PUBLISHED' }));

      await expect(service.publishEvent(EVENT_ID, CLIENT_ID)).resolves.toBeDefined();
    });

    it('throws BadRequestException when no translations', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ status: 'DRAFT', translations: [] }));

      await expect(service.publishEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when title is blank', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(
        baseEvent({ status: 'DRAFT', translations: [{ locale: 'it', title: '   ' }] }),
      );

      await expect(service.publishEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when startTime is in the past', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(
        baseEvent({ status: 'DRAFT', startTime: new Date(Date.now() - 1000) }),
      );

      await expect(service.publishEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for COMPLETED → PUBLISHED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ status: 'COMPLETED' }));

      await expect(service.publishEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeEvent', () => {
    it('transitions PUBLISHED → COMPLETED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ status: 'PUBLISHED' }));
      mockPrisma.event.update.mockResolvedValue(baseEvent({ status: 'COMPLETED' }));

      await expect(service.completeEvent(EVENT_ID, CLIENT_ID)).resolves.toBeDefined();
    });

    it('throws BadRequestException for DRAFT → COMPLETED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ status: 'DRAFT' }));

      await expect(service.completeEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });
  });

  // ── addParticipant — waitlist logic ────────────────────────────────────────

  describe('addParticipant', () => {
    const dto = { type: 'INLINE' as const, userName: 'Mario', email: 'mario@example.com' };

    it('assigns REGISTERED when no maxParticipants', async () => {
      mockTx.event.findFirst.mockResolvedValue(
        baseEvent({ maxParticipants: null, participants: [] }),
      );
      mockTx.participant.create.mockResolvedValue(baseParticipant({ status: 'REGISTERED' }));

      await service.addParticipant(EVENT_ID, CLIENT_ID, dto);

      expect(mockTx.participant.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REGISTERED' }) }),
      );
    });

    it('assigns REGISTERED when slots available', async () => {
      mockTx.event.findFirst.mockResolvedValue(
        baseEvent({ maxParticipants: 5, participants: [baseParticipant(), baseParticipant()] }),
      );
      mockTx.participant.create.mockResolvedValue(baseParticipant({ status: 'REGISTERED' }));

      await service.addParticipant(EVENT_ID, CLIENT_ID, dto);

      expect(mockTx.participant.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REGISTERED' }) }),
      );
    });

    it('assigns WAITLIST when event is full', async () => {
      const full = Array.from({ length: 3 }, () => baseParticipant());
      mockTx.event.findFirst.mockResolvedValue(
        baseEvent({ maxParticipants: 3, participants: full }),
      );
      mockTx.participant.create.mockResolvedValue(baseParticipant({ status: 'WAITLIST' }));

      await service.addParticipant(EVENT_ID, CLIENT_ID, dto);

      expect(mockTx.participant.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLIST' }) }),
      );
    });

    it('throws NotFoundException when event not found', async () => {
      mockTx.event.findFirst.mockResolvedValue(null);

      await expect(service.addParticipant(EVENT_ID, CLIENT_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException on duplicate external participant (P2002)', async () => {
      mockTx.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: null, participants: [] }));
      const err: any = new Error('Unique constraint');
      err.code = 'P2002';
      mockTx.participant.create.mockRejectedValue(err);

      await expect(service.addParticipant(EVENT_ID, CLIENT_ID, dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── removeParticipant — waitlist promotion ─────────────────────────────────

  describe('removeParticipant', () => {
    it('marks participant CANCELLED and promotes first waitlisted when capacity allows', async () => {
      const waitlisted = baseParticipant({ id: 'p-waitlist', status: 'WAITLIST' });

      mockTx.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: 2 }));
      mockTx.participant.findFirst
        .mockResolvedValueOnce(baseParticipant())  // fetch participant to cancel
        .mockResolvedValueOnce(waitlisted);         // first waitlist candidate
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CANCELLED' }));
      mockTx.participant.count.mockResolvedValue(1); // 1 active after cancel → below max

      await service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID);

      // first update: cancel
      expect(mockTx.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
      // second update: promote waitlisted
      expect(mockTx.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p-waitlist' }, data: { status: 'REGISTERED' } }),
      );
    });

    it('does not promote when no waitlisted participant exists', async () => {
      mockTx.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: 2 }));
      mockTx.participant.findFirst
        .mockResolvedValueOnce(baseParticipant())
        .mockResolvedValueOnce(null); // no waitlist
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CANCELLED' }));
      mockTx.participant.count.mockResolvedValue(1);

      await service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID);

      expect(mockTx.participant.update).toHaveBeenCalledTimes(1);
    });

    it('does not promote when active count still at max', async () => {
      mockTx.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: 2 }));
      mockTx.participant.findFirst.mockResolvedValueOnce(baseParticipant());
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CANCELLED' }));
      mockTx.participant.count.mockResolvedValue(2); // still full

      await service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID);

      expect(mockTx.participant.update).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when event not found', async () => {
      mockTx.event.findFirst.mockResolvedValue(null);

      await expect(service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when participant not found', async () => {
      mockTx.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: 5 }));
      mockTx.participant.findFirst.mockResolvedValue(null);

      await expect(service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── updateParticipantStatus — promotion on CANCELLED ─────────────────────

  describe('updateParticipantStatus', () => {
    it('promotes from waitlist when status set to CANCELLED', async () => {
      const waitlisted = baseParticipant({ id: 'p-waitlist', status: 'WAITLIST' });

      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: 1 }));
      mockTx.participant.findFirst
        .mockResolvedValueOnce(baseParticipant())
        .mockResolvedValueOnce(waitlisted);
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CANCELLED' }));
      mockTx.participant.count.mockResolvedValue(0);

      await service.updateParticipantStatus(PARTICIPANT_ID, EVENT_ID, CLIENT_ID, 'CANCELLED');

      expect(mockTx.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p-waitlist' }, data: { status: 'REGISTERED' } }),
      );
    });

    it('does not promote when status set to CONFIRMED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: 5 }));
      mockTx.participant.findFirst.mockResolvedValue(baseParticipant());
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CONFIRMED' }));

      await service.updateParticipantStatus(PARTICIPANT_ID, EVENT_ID, CLIENT_ID, 'CONFIRMED');

      // only the status update, no promotion call
      expect(mockTx.participant.count).not.toHaveBeenCalled();
    });
  });

  // ── addParticipantsBulk ───────────────────────────────────────────────────

  describe('addParticipantsBulk', () => {
    it('returns correct added/waitlisted counts', async () => {
      const event = baseEvent({ maxParticipants: 1, participants: [] });
      mockTx.event.findFirst.mockResolvedValue(event);
      mockTx.participant.create.mockResolvedValue(baseParticipant());

      const result = await service.addParticipantsBulk(EVENT_ID, CLIENT_ID, {
        participants: [
          { type: 'INLINE', userName: 'A' },
          { type: 'INLINE', userName: 'B' },
        ],
      } as any);

      expect(result.added).toBe(1);
      expect(result.waitlisted).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('skips duplicate EXTERNAL participant when skipDuplicates=true', async () => {
      mockTx.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: null, participants: [] }));
      mockTx.participant.findUnique.mockResolvedValue(baseParticipant()); // already exists

      const result = await service.addParticipantsBulk(EVENT_ID, CLIENT_ID, {
        skipDuplicates: true,
        participants: [
          { type: 'EXTERNAL', userName: 'A', externalId: 'ext-1', externalSource: 'discord' },
        ],
      } as any);

      expect(result.skipped).toBe(1);
      expect(result.added).toBe(0);
      expect(mockTx.participant.create).not.toHaveBeenCalled();
    });

    it('records error for duplicate EXTERNAL when skipDuplicates=false', async () => {
      mockTx.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: null, participants: [] }));
      mockTx.participant.findUnique.mockResolvedValue(baseParticipant());

      const result = await service.addParticipantsBulk(EVENT_ID, CLIENT_ID, {
        skipDuplicates: false,
        participants: [
          { type: 'EXTERNAL', userName: 'A', externalId: 'ext-1', externalSource: 'discord' },
        ],
      } as any);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ index: 0, reason: 'Already registered' });
    });

    it('throws NotFoundException when event not found', async () => {
      mockTx.event.findFirst.mockResolvedValue(null);

      await expect(
        service.addParticipantsBulk(EVENT_ID, CLIENT_ID, { participants: [] } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── checkInParticipant ────────────────────────────────────────────────────

  describe('checkInParticipant', () => {
    it('sets checkedIn=true, checkedInAt, status=ATTENDED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent());
      mockPrisma.participant.findFirst.mockResolvedValue(baseParticipant());
      mockPrisma.participant.update.mockResolvedValue(
        baseParticipant({ checkedIn: true, status: 'ATTENDED' }),
      );

      await service.checkInParticipant(PARTICIPANT_ID, EVENT_ID, CLIENT_ID);

      expect(mockPrisma.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ checkedIn: true, status: 'ATTENDED' }),
        }),
      );
    });

    it('throws NotFoundException when event not found', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);

      await expect(
        service.checkInParticipant(PARTICIPANT_ID, EVENT_ID, CLIENT_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when participant not found', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent());
      mockPrisma.participant.findFirst.mockResolvedValue(null);

      await expect(
        service.checkInParticipant(PARTICIPANT_ID, EVENT_ID, CLIENT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getEventStats ─────────────────────────────────────────────────────────

  describe('getEventStats', () => {
    it('returns correct participant counts', async () => {
      const participants = [
        baseParticipant({ status: 'REGISTERED' }),
        baseParticipant({ status: 'REGISTERED' }),
        baseParticipant({ status: 'CONFIRMED' }),
        baseParticipant({ status: 'WAITLIST' }),
        baseParticipant({ status: 'CANCELLED' }),
        baseParticipant({ status: 'ATTENDED', checkedIn: true }),
      ];
      mockPrisma.event.findFirst.mockResolvedValue(
        baseEvent({ maxParticipants: 5, participants }),
      );

      const result = await service.getEventStats(EVENT_ID, CLIENT_ID);

      expect(result.stats).toMatchObject({
        totalParticipants: 6,
        registered: 2,
        confirmed: 1,
        waitlist: 1,
        cancelled: 1,
        attended: 1,
        checkedIn: 1,
        availableSpots: 2, // 5 max - 3 active (registered + confirmed)
      });
    });

    it('returns null availableSpots when maxParticipants not set', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: null, participants: [] }));

      const result = await service.getEventStats(EVENT_ID, CLIENT_ID);

      expect(result.stats.availableSpots).toBeNull();
    });
  });
});
