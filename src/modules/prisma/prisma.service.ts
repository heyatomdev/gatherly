import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.get<string>('DATABASE_URL'),
      max: config.get<number>('DATABASE_POOL_MAX', 10),
      connectionTimeoutMillis: config.get<number>('DATABASE_CONNECTION_TIMEOUT_MS', 5_000),
      statement_timeout: config.get<number>('DATABASE_STATEMENT_TIMEOUT_MS', 30_000),
    });
    super({ adapter });
  }

  /**
   * Runs `fn` only on the replica that wins a transaction-scoped advisory
   * lock named `name`; the others skip. Transaction-scoped (not session) so
   * the lock can't leak onto a pooled connection. Returns false if skipped.
   */
  async withAdvisoryLock(
    name: string,
    fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<boolean> {
    return this.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS locked
        `;
        if (!locked) return false;
        await fn(tx);
        return true;
      },
      { timeout: 120_000 },
    );
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
      this.logger.log('Database disconnected successfully');
    } catch (error) {
      this.logger.error('Failed to disconnect from database', error instanceof Error ? error.stack : error);
      throw error;
    }
  }
}
