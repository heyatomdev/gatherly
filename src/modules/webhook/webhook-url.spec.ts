import { BadRequestException } from '@nestjs/common';
import { request } from 'https';
import {
  BlockedWebhookDestinationError,
  assertSafeWebhookUrl,
  checkWebhookUrl,
  isBlockedAddress,
  webhookAgent,
} from './webhook-url';

describe('webhook URL SSRF guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    '64:ff9b::a00:1',
  ])('blocks %s', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])('allows %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );

  it.each([
    'http://example.com/hook',
    'ftp://example.com',
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://[::1]/hook',
    'https://[::ffff:169.254.169.254]/latest',
    'not a url',
  ])('rejects %s', async (url) => {
    expect(() => checkWebhookUrl(url)).toThrow(BlockedWebhookDestinationError);
    await expect(assertSafeWebhookUrl(url)).rejects.toThrow(BadRequestException);
  });

  it('accepts a public https IP literal', async () => {
    await expect(assertSafeWebhookUrl('https://1.1.1.1/hook')).resolves.toBeUndefined();
  });

  it('send-time agent refuses hostnames that resolve to private addresses', async () => {
    const err = await new Promise<Error>((resolve) => {
      const req = request('https://localhost:1/', { agent: webhookAgent }, () => resolve(new Error('connected')));
      req.on('error', resolve);
      req.end();
    });
    expect(err).toBeInstanceOf(BlockedWebhookDestinationError);
  });
});
