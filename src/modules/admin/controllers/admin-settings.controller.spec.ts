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
    const controller = new AdminSettingsController(new ClientService(prisma as any), { write: jest.fn() } as any);

    const result = await controller.getSettings({ adminClient: { id: 'c1', token: 'tok', webhookSecret: 'sec' } });

    expect(result).toEqual({ id: 'c1', name: 'Gym' });
    expect(prisma.client.findUnique.mock.calls[0][0].select).not.toHaveProperty('token');
    expect(prisma.client.findUnique.mock.calls[0][0].select).not.toHaveProperty('webhookSecret');
  });
});

describe('AdminSettingsController audit', () => {
  const clients = {
    updateClient: jest.fn(async () => ({ id: 'c1' })),
    regenerateWebhookSecret: jest.fn(async () => ({ id: 'c1', webhookSecret: 'new-secret' })),
  };
  const audit = { write: jest.fn() };
  const controller = new AdminSettingsController(clients as any, audit as any);
  const req = {
    adminUser: { sub: 'u1' },
    adminClient: { id: 'c1', webhookUrl: 'https://old.example.com/hook', webhookSecret: 'old-secret' },
  };

  beforeEach(() => jest.clearAllMocks());

  it('audits a webhookUrl change with the acting user', async () => {
    await controller.updateSettings(req, { webhookUrl: 'https://new.example.com/hook' });

    expect(audit.write).toHaveBeenCalledWith('admin.settings.updated', {
      userId: 'u1',
      metadata: { clientId: 'c1', fields: ['webhookUrl'], webhookUrlChanged: true },
    });
  });

  it('audits other settings changes without a webhookUrl flag', async () => {
    await controller.updateSettings(req, { emailActive: true });

    expect(audit.write.mock.calls[0][1].metadata).toEqual({ clientId: 'c1', fields: ['emailActive'] });
  });

  it('audits webhook secret regeneration without logging the secret', async () => {
    const result = await controller.regenerateWebhookSecret(req);

    expect(result.webhookSecret).toBe('new-secret');
    expect(audit.write).toHaveBeenCalledWith('admin.settings.webhook_secret_regenerated', {
      userId: 'u1',
      metadata: { clientId: 'c1' },
    });
    expect(JSON.stringify(audit.write.mock.calls)).not.toContain('new-secret');
  });

  it('does not audit when the update fails', async () => {
    clients.updateClient.mockRejectedValueOnce(new Error('bad url'));

    await expect(controller.updateSettings(req, { webhookUrl: 'https://x.example.com' })).rejects.toThrow();
    expect(audit.write).not.toHaveBeenCalled();
  });
});
