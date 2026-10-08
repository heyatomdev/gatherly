import { WebhookService } from './webhook.service';

describe('WebhookService event payloads', () => {
  it('sends a trimmed event without participants', async () => {
    const prisma = { webhookDelivery: { create: jest.fn() } };
    const service = new WebhookService({} as any, prisma as any);

    await service.notifyEventPublished('https://example.com/hook', 'c1', {
      id: 'e1',
      defaultLocale: 'it',
      translations: [{ locale: 'it', title: 'Torneo' }],
      tags: [{ tag: { slug: '5v5' } }],
      participants: [{ id: 'p1', email: 'mario@example.com', userName: 'Mario' }],
    });

    const data = prisma.webhookDelivery.create.mock.calls[0][0].data.payload.data;
    expect(data).toMatchObject({ id: 'e1', title: 'Torneo', tags: ['5v5'] });
    expect(data).not.toHaveProperty('participants');
    expect(JSON.stringify(data)).not.toContain('mario@example.com');
  });
});
