import { AdminClientsController } from './admin-clients.controller';

/** Bastion's `CreateEventDto` rule: exactly one dot. It stores the event as `gatherly.<name>`. */
const BASTION_EVENT_NAME = /^[a-z0-9_]+\.[a-z0-9_]+$/;

describe('AdminClientsController audit', () => {
  const client = { id: 'c1', tenantId: 't1' };
  const clients = {
    createClient: jest.fn(async () => client),
    updateClient: jest.fn(async () => client),
    revokeClient: jest.fn(async () => client),
    reactivateClient: jest.fn(async () => client),
    regenerateToken: jest.fn(async () => ({ id: 'c1', token: 'new-token' })),
    regenerateWebhookSecret: jest.fn(async () => ({
      id: 'c1',
      webhookSecret: 'new-secret',
    })),
  };
  const audit = { writeAsAdmin: jest.fn() };
  const controller = new AdminClientsController(clients as any, audit as any);
  const req = { adminUser: { sub: 'u1', tenantId: 't0', role: 'SUPER_ADMIN' } };

  beforeEach(() => jest.clearAllMocks());

  async function callAll() {
    await controller.create(req, { tenantId: 't1' } as any);
    await controller.update(req, 'c1', {} as any);
    await controller.revoke(req, 'c1');
    await controller.reactivate(req, 'c1');
    await controller.regenerateToken(req, 'c1');
    await controller.regenerateWebhookSecret(req, 'c1');
  }

  it('attributes every write to the acting admin', async () => {
    await callAll();

    expect(audit.writeAsAdmin.mock.calls.map(([event]) => event)).toEqual([
      'client.created',
      'client.updated',
      'client.revoked',
      'client.reactivated',
      'client.token_regenerated',
      'client.webhook_secret_regenerated',
    ]);
    for (const [, actor] of audit.writeAsAdmin.mock.calls)
      expect(actor).toBe(req.adminUser);
  });

  it('uses event names Bastion accepts', async () => {
    await callAll();

    for (const [event] of audit.writeAsAdmin.mock.calls)
      expect(event).toMatch(BASTION_EVENT_NAME);
  });

  it('never logs the token or the webhook secret', async () => {
    await callAll();

    const logged = JSON.stringify(audit.writeAsAdmin.mock.calls);
    expect(logged).not.toContain('new-token');
    expect(logged).not.toContain('new-secret');
  });
});
