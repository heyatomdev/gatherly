import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PrismaService } from '@/modules/prisma/prisma.service';
import { bootApp, createEvent, createTenant } from './helpers';

/**
 * Real Postgres (Testcontainers, see global-setup.ts) behind the real AppModule:
 * row locks, capacity, check-in rules and tenant scoping as the DB enforces them,
 * not as a mocked Prisma would pretend to.
 */
describe('Events against a real DB (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: () => ReturnType<typeof request>;

  beforeAll(async () => {
    let url: string;
    ({ app, url, prisma } = await bootApp());
    http = () => request(url);
  });

  afterAll(async () => {
    await app?.close();
  });

  const activeCount = (eventId: string) =>
    prisma.participant.count({
      where: {
        eventId,
        status: { in: ['REGISTERED', 'CONFIRMED', 'ATTENDED'] },
      },
    });

  describe('capacity under concurrency', () => {
    it('20 concurrent registrations on a 5-seat event → exactly 5 active, 15 waitlisted', async () => {
      const { client, auth } = await createTenant(prisma);
      const event = await createEvent(prisma, client.id, {
        maxParticipants: 5,
      });

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          http()
            .post(`/events/${event.id}/participants`)
            .set(auth)
            .send({ type: 'INLINE', userName: `user-${i}` }),
        ),
      );

      expect(responses.map((r) => r.status)).toEqual(Array(20).fill(201));
      expect(await activeCount(event.id)).toBe(5);
      expect(
        await prisma.participant.count({
          where: { eventId: event.id, status: 'WAITLIST' },
        }),
      ).toBe(15);
    });

    it('concurrent bulk + single adds never exceed the cap', async () => {
      const { client, auth } = await createTenant(prisma);
      const event = await createEvent(prisma, client.id, {
        maxParticipants: 3,
      });

      await Promise.all([
        ...Array.from({ length: 4 }, (_, i) =>
          http()
            .post(`/events/${event.id}/participants/bulk`)
            .set(auth)
            .send({
              participants: [
                { userName: `bulk-${i}-a` },
                { userName: `bulk-${i}-b` },
              ],
            }),
        ),
        ...Array.from({ length: 4 }, (_, i) =>
          http()
            .post(`/events/${event.id}/participants`)
            .set(auth)
            .send({ userName: `single-${i}` }),
        ),
      ]);

      expect(await activeCount(event.id)).toBe(3);
      expect(
        await prisma.participant.count({ where: { eventId: event.id } }),
      ).toBe(12);
    });

    it('raising maxParticipants promotes the waitlist into the new seats, oldest first', async () => {
      const { client, auth } = await createTenant(prisma);
      const event = await createEvent(prisma, client.id, {
        maxParticipants: 1,
      });
      for (const userName of ['a', 'b', 'c', 'd']) {
        await http()
          .post(`/events/${event.id}/participants`)
          .set(auth)
          .send({ userName })
          .expect(201);
      }

      await http()
        .patch(`/events/${event.id}`)
        .set(auth)
        .send({ maxParticipants: 3 })
        .expect(200);

      const rows = await prisma.participant.findMany({
        where: { eventId: event.id },
        orderBy: { createdAt: 'asc' },
        select: { userName: true, status: true },
      });
      expect(rows).toEqual([
        { userName: 'a', status: 'REGISTERED' },
        { userName: 'b', status: 'REGISTERED' },
        { userName: 'c', status: 'REGISTERED' },
        { userName: 'd', status: 'WAITLIST' },
      ]);

      await http()
        .patch(`/events/${event.id}`)
        .set(auth)
        .send({ maxParticipants: null })
        .expect(200);
      expect(
        await prisma.participant.count({
          where: { eventId: event.id, status: 'WAITLIST' },
        }),
      ).toBe(0);
    });
  });

  describe('registration rules', () => {
    it.each([
      ['DRAFT', { status: 'DRAFT' as const }],
      ['CANCELLED', { status: 'CANCELLED' as const }],
      ['COMPLETED', { status: 'COMPLETED' as const }],
      ['past', { startTime: new Date(Date.now() - 86_400_000) }],
    ])(
      'rejects registration on a %s event with 409 (single and bulk)',
      async (_, data) => {
        const { client, auth } = await createTenant(prisma);
        const event = await createEvent(prisma, client.id, data);

        await http()
          .post(`/events/${event.id}/participants`)
          .set(auth)
          .send({ userName: 'x' })
          .expect(409);
        await http()
          .post(`/events/${event.id}/participants/bulk`)
          .set(auth)
          .send({ participants: [{ userName: 'y' }] })
          .expect(409);
        expect(
          await prisma.participant.count({ where: { eventId: event.id } }),
        ).toBe(0);
      },
    );
  });

  describe('POST /events', () => {
    const body = {
      translations: [{ locale: 'it', title: 'Evento' }],
      authorId: 'author-1',
      authorName: 'Author',
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
    };

    it('creates a DRAFT and rejects `status` — publishing goes through PUT /publish', async () => {
      const { client, auth } = await createTenant(prisma);

      await http()
        .post('/events')
        .set(auth)
        .send({ ...body, status: 'PUBLISHED' })
        .expect(400);
      const { data: created } = (
        await http().post('/events').set(auth).send(body).expect(201)
      ).body;

      expect(created.status).toBe('DRAFT');
      expect(await prisma.event.count({ where: { clientId: client.id } })).toBe(
        1,
      );
    });
  });

  describe('PATCH /events/:id', () => {
    it('rejects `status` in the body — transitions go through /publish, /cancel, /complete', async () => {
      const { client, auth } = await createTenant(prisma);
      const event = await createEvent(prisma, client.id, { status: 'DRAFT' });

      await http()
        .patch(`/events/${event.id}`)
        .set(auth)
        .send({ status: 'PUBLISHED' })
        .expect(400);
      expect(
        (await prisma.event.findUniqueOrThrow({ where: { id: event.id } }))
          .status,
      ).toBe('DRAFT');
    });
  });

  describe('check-in', () => {
    it('REGISTERED → ATTENDED keeps the seat; repeat is idempotent; WAITLIST/CANCELLED are refused', async () => {
      const { client, auth } = await createTenant(prisma);
      const event = await createEvent(prisma, client.id, {
        maxParticipants: 1,
      });
      const base = `/events/${event.id}/participants`;

      const seated = (
        await http()
          .post(base)
          .set(auth)
          .send({ userName: 'seated' })
          .expect(201)
      ).body.data;
      const waiting = (
        await http()
          .post(base)
          .set(auth)
          .send({ userName: 'waiting' })
          .expect(201)
      ).body.data;
      expect(seated.status).toBe('REGISTERED');
      const seatedId = seated.id;
      const waitingId = waiting.id;

      await http().put(`${base}/${seatedId}/checkin`).set(auth).expect(200);
      await http().put(`${base}/${seatedId}/checkin`).set(auth).expect(200);
      const row = await prisma.participant.findUniqueOrThrow({
        where: { id: seatedId },
      });
      expect(row).toMatchObject({ status: 'ATTENDED', checkedIn: true });

      // The checked-in participant still holds the only seat.
      await http().put(`${base}/${waitingId}/checkin`).set(auth).expect(409);
      await http()
        .patch(`${base}/${waitingId}/status`)
        .set(auth)
        .send({ status: 'ATTENDED' })
        .expect(409)
        .expect(({ body }) => expect(body.code).toBe('EVENT_FULL'));
      await http().post(base).set(auth).send({ userName: 'late' }).expect(201);
      expect(await activeCount(event.id)).toBe(1);

      await http()
        .patch(`${base}/${waitingId}/status`)
        .set(auth)
        .send({ status: 'CANCELLED' })
        .expect(200);
      await http().put(`${base}/${waitingId}/checkin`).set(auth).expect(409);
    });
  });

  describe('tenant isolation', () => {
    it("another tenant gets 404 on every /events/:id route of someone else's event", async () => {
      const owner = await createTenant(prisma);
      const intruder = await createTenant(prisma);
      const event = await createEvent(prisma, owner.client.id, {
        maxParticipants: 10,
      });
      const participant = await prisma.participant.create({
        data: {
          eventId: event.id,
          userName: 'victim',
          email: 'victim@example.com',
        },
      });
      const e = `/events/${event.id}`;
      const p = `${e}/participants/${participant.id}`;

      const attempts = [
        http().get(e),
        http().get(`${e}/stats`),
        http().get(`${e}/participants`),
        http().patch(e).send({ locationName: 'pwned' }),
        http().put(`${e}/publish`),
        http().put(`${e}/cancel`),
        http().put(`${e}/complete`),
        http().post(`${e}/participants`).send({ userName: 'intruder' }),
        http()
          .post(`${e}/participants/bulk`)
          .send({ participants: [{ userName: 'intruder' }] }),
        http().patch(`${p}/status`).send({ status: 'CANCELLED' }),
        http().put(`${p}/checkin`),
        http().delete(p),
      ];
      const statuses = await Promise.all(
        attempts.map((r) => r.set(intruder.auth).then((res) => res.status)),
      );

      expect(statuses).toEqual(Array(attempts.length).fill(404));
      expect(
        await prisma.event.findUniqueOrThrow({ where: { id: event.id } }),
      ).toMatchObject({
        status: 'PUBLISHED',
        locationName: null,
      });
      expect(
        await prisma.participant.findMany({ where: { eventId: event.id } }),
      ).toEqual([
        expect.objectContaining({
          id: participant.id,
          status: 'REGISTERED',
          checkedIn: false,
        }),
      ]);
    });
  });
});
