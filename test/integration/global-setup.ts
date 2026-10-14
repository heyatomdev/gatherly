import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

declare global {
  // eslint-disable-next-line no-var
  var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Starts a throwaway Postgres 17 (as in production; Docker required) and applies
 * the real migrations with `prisma migrate deploy` — the same path production
 * takes, so raw-SQL indexes and row locks are exercised for real. Workers
 * inherit DATABASE_URL.
 */
export default async function globalSetup() {
  const container = await new PostgreSqlContainer('postgres:17')
    .withDatabase('gatherly_test')
    .start();
  globalThis.__PG_CONTAINER__ = container;
  process.env.DATABASE_URL = container.getConnectionUri();

  const root = join(__dirname, '..', '..');
  execFileSync(join(root, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
  });
}
