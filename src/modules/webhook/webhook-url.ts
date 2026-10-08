import { BadRequestException } from '@nestjs/common';
import { BlockList, isIP } from 'net';
import { lookup, LookupAddress } from 'dns';
import { promisify } from 'util';
import { Agent } from 'https';

// Destinations a tenant-supplied webhook URL must never reach (SSRF).
// IPv4-mapped IPv6 (::ffff:a.b.c.d) is matched against the IPv4 rules by BlockList itself.
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata (169.254.169.254)
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3], // multicast + reserved + broadcast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96], // NAT64 can wrap private IPv4
  ['2002::', 16], // 6to4 can wrap private IPv4
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

export class BlockedWebhookDestinationError extends Error {}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  return family === 0 || BLOCKED.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Synchronous part of the check: https only, and IP-literal hosts must be public.
 * Hostnames are checked by DNS — see assertSafeWebhookUrl (save time) and webhookAgent (send time).
 */
export function checkWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedWebhookDestinationError('Invalid webhook URL');
  }
  if (url.protocol !== 'https:') throw new BlockedWebhookDestinationError('Webhook URL must use https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new BlockedWebhookDestinationError('Webhook URL points to a private address');
  }
  if (isIP(host) && isBlockedAddress(host)) {
    throw new BlockedWebhookDestinationError('Webhook URL points to a private address');
  }
  return url;
}

/** Save-time validation: throws 400 if the URL is not https or resolves to a private address. */
export async function assertSafeWebhookUrl(raw: string): Promise<void> {
  try {
    const url = checkWebhookUrl(raw);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) return;
    const addresses = await promisify(lookup)(host, { all: true }).catch(() => {
      throw new BlockedWebhookDestinationError('Webhook host does not resolve');
    });
    if (addresses.some((a) => isBlockedAddress(a.address))) {
      throw new BlockedWebhookDestinationError('Webhook URL points to a private address');
    }
  } catch (error) {
    if (error instanceof BlockedWebhookDestinationError) throw new BadRequestException(error.message);
    throw error;
  }
}

/** dns.lookup that refuses private addresses — re-checked on every connect, so DNS rebinding can't slip past the save-time check. */
function safeLookup(hostname: string, options: any, callback: any) {
  lookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err);
    if (addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(new BlockedWebhookDestinationError('Webhook URL points to a private address'));
    }
    if (options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

export const webhookAgent = new Agent({ lookup: safeLookup });
