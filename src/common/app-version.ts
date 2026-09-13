import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface PackageManifest {
  version?: string;
}

let cachedVersion: string | undefined;

/**
 * Reads the application version from package.json once, then caches it.
 * The manifest is copied next to the compiled bundle in the Docker image,
 * so `process.cwd()` resolves it both in development and in production.
 */
export function getAppVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;

  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    cachedVersion = (JSON.parse(raw) as PackageManifest).version ?? 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }

  return cachedVersion;
}
