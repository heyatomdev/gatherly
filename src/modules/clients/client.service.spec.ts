import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientService } from './client.service';

// The SSRF rules themselves are tested in @heyatom/nest-common; this only pins the 400 mapping.
describe('ClientService webhookUrl validation', () => {
  const prisma = {
    client: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  };
  const service = new ClientService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.client.findUnique.mockResolvedValue({ id: 'c1' });
  });

  it.each([
    'http://example.com/hook',
    'https://127.0.0.1/hook',
    'https://[::ffff:169.254.169.254]/latest',
    'https://localhost/hook',
    'https://user:pass@example.com/hook',
    'not a url',
  ])('rejects %s with 400 and writes nothing', async (webhookUrl) => {
    await expect(
      service.createClient({ name: 'x', tenantId: 't', webhookUrl } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateClient('c1', { webhookUrl } as any),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.client.create).not.toHaveBeenCalled();
    expect(prisma.client.update).not.toHaveBeenCalled();
  });

  it('accepts a public https IP literal (no DNS needed)', async () => {
    prisma.client.update.mockResolvedValue({ id: 'c1' });
    await expect(
      service.updateClient('c1', { webhookUrl: 'https://1.1.1.1/hook' } as any),
    ).resolves.toEqual({
      id: 'c1',
    });
  });
});
