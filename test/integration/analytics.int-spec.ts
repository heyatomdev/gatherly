import { INestApplication } from '@nestjs/common';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AdminAnalyticsService } from '@/modules/admin/analytics/admin-analytics.service';
import { bootApp, createEvent, createTenant } from './helpers';

describe('Admin stats against a real DB (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let analytics: AdminAnalyticsService;

  beforeAll(async () => {
    ({ app, prisma } = await bootApp());
    analytics = app.get(AdminAnalyticsService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('check-in rate counts only participants still holding a seat (never > 100%)', async () => {
    const { client } = await createTenant(prisma);
    const event = await createEvent(prisma, client.id, { status: 'COMPLETED' });
    const p = (status: string, checkedIn: boolean) => ({
      eventId: event.id,
      type: 'INLINE' as const,
      userName: `${status}-${checkedIn}`,
      status: status as any,
      checkedIn,
    });
    await prisma.participant.createMany({
      data: [
        p('ATTENDED', true),
        // checked in, then cancelled: keeps checkedIn = true
        p('CANCELLED', true),
        p('CONFIRMED', false),
      ],
    });

    const stats = await analytics.tenantStats(client.id);

    expect(stats.participants.checkedIn).toBe(1);
    expect(stats.rates.checkInRate).toBe(0.5);
    expect(stats.rates.noShowRate).toBe(0.5);
  });
});
