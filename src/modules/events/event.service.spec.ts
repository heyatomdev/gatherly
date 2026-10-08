import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventService } from './event.service';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { BastionAuditService } from '@heyatom/bastion-client/nest';
import { WebhookService } from '@/modules/webhook/webhook.service';
// ── mock tx used inside $transaction callbacks ──────────────────────────────
const mockTx = {
  $queryRaw: jest.fn(),
  event: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    createMany: jest.fn(),
  },
  participant: {
    create: jest.fn(),
    createManyAndReturn: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  tag: { createMany: jest.fn(), findMany: jest.fn() },
  recurrenceRule: { create: jest.fn() },
  eventTranslation: { createMany: jest.fn(), upsert: jest.fn() },
  eventTag: { createMany: jest.fn(), deleteMany: jest.fn() },
  idempotencyKey: { deleteMany: jest.fn() },
};

const mockPrisma = {
  event: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  participant: {
    findFirst: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  eventCategory: { findFirst: jest.fn() },
  $transaction: jest.fn(),
  withAdvisoryLock: jest.fn(),
};

const defaultTransaction = async (arg: any) =>
  typeof arg === 'function' ? arg(mockTx) : Promise.all(arg);

/** Row returned by the SELECT ... FOR UPDATE in lockEvent. */
const lockReturns = (maxParticipants: number | null) =>
  mockTx.$queryRaw.mockResolvedValue([{ id: EVENT_ID, maxParticipants }]);

const mockAudit = { write: jest.fn() };
const mockWebhook = { notify: jest.fn() };

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
        { provide: WebhookService, useValue: mockWebhook },
      ],
    }).compile();

    service = module.get(EventService);
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation(defaultTransaction);
    mockPrisma.withAdvisoryLock.mockImplementation(async (_name: string, fn: any) => {
      await fn(mockTx);
      return true;
    });
    mockWebhook.notify.mockResolvedValue(undefined);
  });

  // ── Listing ────────────────────────────────────────────────────────────────

  describe('getEventsByClient', () => {
    beforeEach(() => {
      mockPrisma.event.findMany.mockResolvedValue([]);
      mockPrisma.event.count.mockResolvedValue(0);
    });

    it('combines fromDate and toDate into one startTime range', async () => {
      await service.getEventsByClient(CLIENT_ID, {
        fromDate: '2026-01-01T00:00:00Z',
        toDate: '2026-02-01T00:00:00Z',
      } as any);

      const { where } = mockPrisma.event.findMany.mock.calls[0][0];
      expect(where.startTime).toEqual({
        gte: new Date('2026-01-01T00:00:00Z'),
        lte: new Date('2026-02-01T00:00:00Z'),
      });
    });

    it('returns an active participant count instead of participant rows', async () => {
      await service.getEventsByClient(CLIENT_ID, {} as any);

      const { include } = mockPrisma.event.findMany.mock.calls[0][0];
      expect(include.participants).toBeUndefined();
      expect(include._count.select.participants.where).toEqual({
        status: { in: ['REGISTERED', 'CONFIRMED'] },
      });
    });
  });

  // ── Create / update ────────────────────────────────────────────────────────

  describe('createEvent', () => {
    const dto = {
      translations: [{ locale: 'it', title: 'Evento' }],
      authorId: 'a1',
      authorName: 'Mario',
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
    };

    it('rejects an unknown category before writing anything', async () => {
      mockPrisma.eventCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.createEvent(CLIENT_ID, { ...dto, categoryId: 'nope', recurrenceRule: 'FREQ=DAILY' } as any),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockTx.recurrenceRule.create).not.toHaveBeenCalled();
    });

    it('dedupes lowercased tag slugs and resolves them in two queries', async () => {
      mockTx.tag.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      mockTx.event.create.mockResolvedValue(baseEvent());

      await service.createEvent(CLIENT_ID, { ...dto, tagSlugs: ['Yoga', 'yoga', '5v5'] } as any);

      expect(mockTx.tag.createMany).toHaveBeenCalledWith({
        data: [
          { clientId: CLIENT_ID, slug: 'yoga' },
          { clientId: CLIENT_ID, slug: '5v5' },
        ],
        skipDuplicates: true,
      });
      expect(mockTx.event.create.mock.calls[0][0].data.tags).toEqual({
        create: [{ tagId: 't1' }, { tagId: 't2' }],
      });
      expect(mockWebhook.notify).toHaveBeenCalledWith(
        CLIENT_ID, 'event.created', expect.objectContaining({ id: EVENT_ID }), undefined,
      );
    });
  });

  describe('updateEvent', () => {
    it('writes translations, tags and scalars in one transaction', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ status: 'DRAFT' });
      mockTx.tag.findMany.mockResolvedValue([{ id: 't1' }]);
      mockTx.event.update.mockResolvedValue(baseEvent());

      await service.updateEvent(EVENT_ID, CLIENT_ID, {
        translations: [{ locale: 'en', title: 'Event' }],
        tagSlugs: ['yoga'],
        locationName: 'Gym',
      } as any);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.eventTranslation.upsert).toHaveBeenCalledTimes(1);
      expect(mockTx.eventTag.deleteMany).toHaveBeenCalledWith({ where: { eventId: EVENT_ID } });
      expect(mockTx.event.update).toHaveBeenCalled();
      expect(mockWebhook.notify).toHaveBeenCalledWith(CLIENT_ID, 'event.updated', expect.anything(), undefined);
    });

    it('throws NotFoundException when event not found', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);

      await expect(service.updateEvent(EVENT_ID, CLIENT_ID, {} as any)).rejects.toThrow(NotFoundException);
    });
  });

  // ── State machine ──────────────────────────────────────────────────────────

  describe('cancelEvent', () => {
    it('transitions PUBLISHED → CANCELLED and emits event.cancelled', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ status: 'PUBLISHED' });
      mockTx.event.update.mockResolvedValue(baseEvent({ status: 'CANCELLED' }));
      mockTx.event.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelEvent(EVENT_ID, CLIENT_ID)).resolves.toBeDefined();
      expect(mockTx.event.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
      expect(mockWebhook.notify).toHaveBeenCalledWith(CLIENT_ID, 'event.cancelled', expect.anything(), undefined);
    });

    it('throws BadRequestException for CANCELLED → CANCELLED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ status: 'CANCELLED' });

      await expect(service.cancelEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for COMPLETED → CANCELLED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ status: 'COMPLETED' });

      await expect(service.cancelEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });
  });

  describe('publishEvent', () => {
    it('transitions DRAFT → PUBLISHED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ status: 'DRAFT' }));
      mockPrisma.event.update.mockResolvedValue(baseEvent({ status: 'PUBLISHED' }));

      await expect(service.publishEvent(EVENT_ID, CLIENT_ID)).resolves.toBeDefined();
      expect(mockWebhook.notify).toHaveBeenCalledWith(CLIENT_ID, 'event.published', expect.anything(), undefined);
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
      mockPrisma.event.findFirst.mockResolvedValue({ status: 'PUBLISHED' });
      mockPrisma.event.update.mockResolvedValue(baseEvent({ status: 'COMPLETED' }));

      await expect(service.completeEvent(EVENT_ID, CLIENT_ID)).resolves.toBeDefined();
      expect(mockWebhook.notify).toHaveBeenCalledWith(CLIENT_ID, 'event.completed', expect.anything(), undefined);
    });

    it('throws BadRequestException for DRAFT → COMPLETED', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ status: 'DRAFT' });

      await expect(service.completeEvent(EVENT_ID, CLIENT_ID)).rejects.toThrow(BadRequestException);
    });

    it('does not fail the request when webhook enqueue fails', async () => {
      mockPrisma.event.findFirst.mockResolvedValue({ status: 'PUBLISHED' });
      mockPrisma.event.update.mockResolvedValue(baseEvent({ status: 'COMPLETED' }));
      mockWebhook.notify.mockRejectedValue(new Error('db down'));

      await expect(service.completeEvent(EVENT_ID, CLIENT_ID)).resolves.toBeDefined();
    });
  });

  // ── addParticipant — waitlist logic under row lock ─────────────────────────

  describe('addParticipant', () => {
    const dto = { type: 'INLINE' as const, userName: 'Mario', email: 'mario@example.com' };

    beforeEach(() => mockTx.participant.create.mockResolvedValue(baseParticipant()));

    it('locks the event row with FOR UPDATE scoped to the client', async () => {
      lockReturns(null);

      await service.addParticipant(EVENT_ID, CLIENT_ID, dto);

      const [strings, ...values] = mockTx.$queryRaw.mock.calls[0];
      expect(strings.join('?')).toMatch(/FOR UPDATE/);
      expect(values).toEqual([EVENT_ID, CLIENT_ID]);
      expect(mockPrisma.$transaction.mock.calls[0][1]).toBeUndefined(); // no Serializable
    });

    it('assigns REGISTERED when no maxParticipants', async () => {
      lockReturns(null);

      await service.addParticipant(EVENT_ID, CLIENT_ID, dto);

      expect(mockTx.participant.count).not.toHaveBeenCalled();
      expect(mockTx.participant.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REGISTERED' }) }),
      );
      expect(mockWebhook.notify).toHaveBeenCalledWith(CLIENT_ID, 'participant.joined', expect.anything(), undefined);
    });

    it('assigns REGISTERED when slots available', async () => {
      lockReturns(5);
      mockTx.participant.count.mockResolvedValue(2);

      await service.addParticipant(EVENT_ID, CLIENT_ID, dto);

      expect(mockTx.participant.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REGISTERED' }) }),
      );
    });

    it('assigns WAITLIST when event is full', async () => {
      lockReturns(3);
      mockTx.participant.count.mockResolvedValue(3);

      await service.addParticipant(EVENT_ID, CLIENT_ID, dto);

      expect(mockTx.participant.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'WAITLIST' }) }),
      );
    });

    it('throws NotFoundException when event not found', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(service.addParticipant(EVENT_ID, CLIENT_ID, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException on duplicate external participant (P2002)', async () => {
      lockReturns(null);
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
      lockReturns(2);
      mockTx.participant.findFirst
        .mockResolvedValueOnce({ id: PARTICIPANT_ID }) // participant to cancel
        .mockResolvedValueOnce({ id: 'p-waitlist' }); // first waitlist candidate
      mockTx.participant.update
        .mockResolvedValueOnce(baseParticipant({ status: 'CANCELLED' }))
        .mockResolvedValueOnce(baseParticipant({ id: 'p-waitlist', status: 'REGISTERED' }));
      mockTx.participant.count.mockResolvedValue(1); // 1 active after cancel → below max

      await service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID);

      expect(mockTx.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
      expect(mockTx.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p-waitlist' }, data: { status: 'REGISTERED' } }),
      );
      expect(mockWebhook.notify).toHaveBeenCalledWith(CLIENT_ID, 'participant.removed', expect.anything(), undefined);
      expect(mockWebhook.notify).toHaveBeenCalledWith(
        CLIENT_ID, 'participant.status_changed', expect.objectContaining({ id: 'p-waitlist' }),
        { previousStatus: 'WAITLIST' },
      );
    });

    it('does not promote when no waitlisted participant exists', async () => {
      lockReturns(2);
      mockTx.participant.findFirst
        .mockResolvedValueOnce({ id: PARTICIPANT_ID })
        .mockResolvedValueOnce(null);
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CANCELLED' }));
      mockTx.participant.count.mockResolvedValue(1);

      await service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID);

      expect(mockTx.participant.update).toHaveBeenCalledTimes(1);
    });

    it('does not promote when active count still at max', async () => {
      lockReturns(2);
      mockTx.participant.findFirst.mockResolvedValueOnce({ id: PARTICIPANT_ID });
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CANCELLED' }));
      mockTx.participant.count.mockResolvedValue(2); // still full

      await service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID);

      expect(mockTx.participant.update).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when event not found', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when participant not found', async () => {
      lockReturns(5);
      mockTx.participant.findFirst.mockResolvedValue(null);

      await expect(service.removeParticipant(EVENT_ID, CLIENT_ID, PARTICIPANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── updateParticipantStatus ────────────────────────────────────────────────

  describe('updateParticipantStatus', () => {
    it('promotes from waitlist when status set to CANCELLED', async () => {
      lockReturns(1);
      mockTx.participant.findFirst
        .mockResolvedValueOnce({ status: 'REGISTERED' })
        .mockResolvedValueOnce({ id: 'p-waitlist' });
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CANCELLED' }));
      mockTx.participant.count.mockResolvedValue(0);

      await service.updateParticipantStatus(PARTICIPANT_ID, EVENT_ID, CLIENT_ID, 'CANCELLED');

      expect(mockTx.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p-waitlist' }, data: { status: 'REGISTERED' } }),
      );
      expect(mockWebhook.notify).toHaveBeenCalledWith(
        CLIENT_ID, 'participant.status_changed', expect.anything(), { previousStatus: 'REGISTERED' },
      );
    });

    it('does not promote when status set to CONFIRMED', async () => {
      lockReturns(5);
      mockTx.participant.findFirst.mockResolvedValue({ status: 'REGISTERED' });
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CONFIRMED' }));

      await service.updateParticipantStatus(PARTICIPANT_ID, EVENT_ID, CLIENT_ID, 'CONFIRMED');

      // REGISTERED → CONFIRMED keeps its seat: no capacity check, no promotion
      expect(mockTx.participant.count).not.toHaveBeenCalled();
      expect(mockTx.participant.update).toHaveBeenCalledTimes(1);
    });

    it('rejects WAITLIST → REGISTERED when the event is full', async () => {
      lockReturns(2);
      mockTx.participant.findFirst.mockResolvedValue({ status: 'WAITLIST' });
      mockTx.participant.count.mockResolvedValue(2);

      await expect(
        service.updateParticipantStatus(PARTICIPANT_ID, EVENT_ID, CLIENT_ID, 'REGISTERED'),
      ).rejects.toThrow(ConflictException);
      expect(mockTx.participant.update).not.toHaveBeenCalled();
    });

    it('allows WAITLIST → CONFIRMED when a seat is free', async () => {
      lockReturns(2);
      mockTx.participant.findFirst.mockResolvedValue({ status: 'WAITLIST' });
      mockTx.participant.count.mockResolvedValue(1);
      mockTx.participant.update.mockResolvedValue(baseParticipant({ status: 'CONFIRMED' }));

      await service.updateParticipantStatus(PARTICIPANT_ID, EVENT_ID, CLIENT_ID, 'CONFIRMED');

      expect(mockTx.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CONFIRMED' } }),
      );
    });
  });

  // ── addParticipantsBulk ───────────────────────────────────────────────────

  describe('addParticipantsBulk', () => {
    beforeEach(() => {
      mockTx.participant.findMany.mockResolvedValue([]);
      mockTx.participant.count.mockResolvedValue(0);
      mockTx.participant.createManyAndReturn.mockImplementation(async ({ data }: any) => data);
    });

    it('returns correct added/waitlisted counts with a single insert', async () => {
      lockReturns(1);

      const result = await service.addParticipantsBulk(EVENT_ID, CLIENT_ID, {
        participants: [
          { type: 'INLINE', userName: 'A' },
          { type: 'INLINE', userName: 'B' },
        ],
      } as any);

      expect(result).toEqual({ added: 1, waitlisted: 1, skipped: 0, errors: [] });
      expect(mockTx.participant.createManyAndReturn).toHaveBeenCalledTimes(1);
      const rows = mockTx.participant.createManyAndReturn.mock.calls[0][0].data;
      expect(rows.map((r: any) => r.status)).toEqual(['REGISTERED', 'WAITLIST']);
      expect(mockWebhook.notify).toHaveBeenCalledWith(
        CLIENT_ID, 'participant.joined', expect.arrayContaining([expect.anything()]), undefined,
      );
    });

    it('skips duplicates already registered and repeated within the batch', async () => {
      lockReturns(null);
      mockTx.participant.findMany.mockResolvedValue([{ externalId: 'ext-1', externalSource: 'discord' }]);

      const result = await service.addParticipantsBulk(EVENT_ID, CLIENT_ID, {
        skipDuplicates: true,
        participants: [
          { type: 'EXTERNAL', userName: 'A', externalId: 'ext-1', externalSource: 'discord' },
          { type: 'EXTERNAL', userName: 'B', externalId: 'ext-2', externalSource: 'discord' },
          { type: 'EXTERNAL', userName: 'B2', externalId: 'ext-2', externalSource: 'discord' },
          { type: 'EXTERNAL', userName: 'C', externalId: 'ext-2', externalSource: 'steam' },
        ],
      } as any);

      expect(result).toEqual({ added: 2, waitlisted: 0, skipped: 2, errors: [] });
      expect(mockTx.participant.findMany).toHaveBeenCalledTimes(1);
    });

    it('records error for duplicate EXTERNAL when skipDuplicates=false', async () => {
      lockReturns(null);
      mockTx.participant.findMany.mockResolvedValue([{ externalId: 'ext-1', externalSource: 'discord' }]);

      const result = await service.addParticipantsBulk(EVENT_ID, CLIENT_ID, {
        skipDuplicates: false,
        participants: [
          { type: 'EXTERNAL', userName: 'A', externalId: 'ext-1', externalSource: 'discord' },
        ],
      } as any);

      expect(result.errors).toEqual([{ index: 0, reason: 'Already registered' }]);
      expect(mockTx.participant.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when event not found', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(
        service.addParticipantsBulk(EVENT_ID, CLIENT_ID, { participants: [] } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── checkInParticipant ────────────────────────────────────────────────────

  describe('checkInParticipant', () => {
    it('sets checkedIn=true, checkedInAt, status=ATTENDED', async () => {
      mockPrisma.participant.findFirst.mockResolvedValue({ id: PARTICIPANT_ID });
      mockPrisma.participant.update.mockResolvedValue(
        baseParticipant({ checkedIn: true, status: 'ATTENDED' }),
      );

      await service.checkInParticipant(PARTICIPANT_ID, EVENT_ID, CLIENT_ID);

      expect(mockPrisma.participant.findFirst.mock.calls[0][0].where).toEqual({
        id: PARTICIPANT_ID, eventId: EVENT_ID, event: { clientId: CLIENT_ID },
      });
      expect(mockPrisma.participant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ checkedIn: true, status: 'ATTENDED' }),
        }),
      );
      expect(mockWebhook.notify).toHaveBeenCalledWith(CLIENT_ID, 'participant.checked_in', expect.anything(), undefined);
    });

    it('throws NotFoundException when participant (or event of this client) not found', async () => {
      mockPrisma.participant.findFirst.mockResolvedValue(null);

      await expect(
        service.checkInParticipant(PARTICIPANT_ID, EVENT_ID, CLIENT_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getEventStats ─────────────────────────────────────────────────────────

  describe('getEventStats', () => {
    it('returns correct participant counts from a groupBy', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: 5 }));
      mockPrisma.participant.groupBy.mockResolvedValue([
        { status: 'REGISTERED', _count: { _all: 2 } },
        { status: 'CONFIRMED', _count: { _all: 1 } },
        { status: 'WAITLIST', _count: { _all: 1 } },
        { status: 'CANCELLED', _count: { _all: 1 } },
        { status: 'ATTENDED', _count: { _all: 1 } },
      ]);
      mockPrisma.participant.count.mockResolvedValue(1);

      const result = await service.getEventStats(EVENT_ID, CLIENT_ID);

      expect(result.stats).toEqual({
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
      mockPrisma.event.findFirst.mockResolvedValue(baseEvent({ maxParticipants: null }));
      mockPrisma.participant.groupBy.mockResolvedValue([]);
      mockPrisma.participant.count.mockResolvedValue(0);

      const result = await service.getEventStats(EVENT_ID, CLIENT_ID);

      expect(result.stats.availableSpots).toBeNull();
      expect(result.stats.totalParticipants).toBe(0);
    });

    it('throws NotFoundException when event not found', async () => {
      mockPrisma.event.findFirst.mockResolvedValue(null);

      await expect(service.getEventStats(EVENT_ID, CLIENT_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // ── Cron ──────────────────────────────────────────────────────────────────

  describe('cleanupPastEvents', () => {
    it('only marks past children COMPLETED under an advisory lock — never deletes', async () => {
      await service.cleanupPastEvents();

      expect(mockPrisma.withAdvisoryLock).toHaveBeenCalledWith('events.cleanupPastEvents', expect.any(Function));
      expect(mockTx.event.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'COMPLETED' } }),
      );
      expect((mockTx.event as any).deleteMany).toBeUndefined();
    });
  });
});
