import { ClientService } from '@/modules/clients/client.service';
import { AdminSettingsController } from './admin-settings.controller';

describe('AdminSettingsController.getSettings', () => {
  it('does not expose token or webhookSecret', async () => {
    const prisma = {
      client: {
        findUnique: jest.fn(async ({ select }) => {
          const row = { id: 'c1', name: 'Gym', token: 'tok', webhookSecret: 'sec' };
          return Object.fromEntries(Object.entries(row).filter(([k]) => select[k]));
        }),
      },
    };
    const controller = new AdminSettingsController(new ClientService(prisma as any));

    const result = await controller.getSettings({ adminClient: { id: 'c1', token: 'tok', webhookSecret: 'sec' } });

    expect(result).toEqual({ id: 'c1', name: 'Gym' });
    expect(prisma.client.findUnique.mock.calls[0][0].select).not.toHaveProperty('token');
    expect(prisma.client.findUnique.mock.calls[0][0].select).not.toHaveProperty('webhookSecret');
  });
});
