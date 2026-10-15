import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { Observable, from, throwError } from 'rxjs';
import { catchError, concatMap, switchMap } from 'rxjs/operators';
import { PrismaService } from '@/modules/prisma/prisma.service';

const MAX_KEY_LENGTH = 128;
const TTL_MS = 24 * 60 * 60 * 1000;
// statusCode 0 marks a claimed key whose request is still running
const IN_PROGRESS = 0;
/**
 * An IN_PROGRESS claim older than this is treated as abandoned (process crashed mid-request) and
 * taken over. Comfortably above the 30s DB statement timeout, so a live request is not re-run.
 */
export const STALE_CLAIM_MS = 2 * 60 * 1000;

type ClaimKey = { key: string; clientId: string; path: string };

/** JSON with object keys sorted, so a retry that re-serializes the same body hashes the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body ?? null)).digest('hex');
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey || !req.client) {
      return next.handle();
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length > MAX_KEY_LENGTH) {
      throw new BadRequestException(`Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`);
    }

    const where = {
      key_clientId_path: {
        key: idempotencyKey,
        clientId: req.client.id as string,
        path: `${req.method} ${req.originalUrl}`,
      },
    };

    const requestHash = hashRequestBody(req.body);

    // Claim the key first: the unique constraint makes concurrent same-key requests lose here
    // instead of both running the handler. A claim abandoned by a crash is taken over after
    // STALE_CLAIM_MS (see claim()).
    return from(this.claim(where.key_clientId_path, requestHash)).pipe(
      switchMap((existing) => {
        if (existing) {
          res.status(existing.statusCode);
          return from(Promise.resolve(existing.responseBody));
        }

        return next.handle().pipe(
          concatMap(async (responseBody) => {
            await this.store(where, responseBody, res.statusCode);
            return responseBody;
          }),
          catchError((err) =>
            from(this.prisma.idempotencyKey.delete({ where }).catch(() => undefined)).pipe(
              switchMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }

  /**
   * Saves the response for replay. Retried once; if it still fails the claim is released, so the
   * key is not stuck IN_PROGRESS (a retry with the same key then re-runs the handler — logged as
   * error because that can duplicate the side effect).
   */
  private async store(where: { key_clientId_path: ClaimKey }, responseBody: unknown, statusCode: number) {
    const save = () =>
      this.prisma.idempotencyKey.update({
        where,
        data: { responseBody: (responseBody ?? Prisma.JsonNull) as Prisma.InputJsonValue, statusCode },
      });
    try {
      await save().catch(save);
    } catch (err) {
      this.logger.error(`idempotency store failed, releasing key: ${(err as Error).message}`);
      await this.prisma.idempotencyKey.delete({ where }).catch(() => undefined);
    }
  }

  /**
   * Inserts the in-progress placeholder (returns null: caller runs the handler). If the key is
   * taken, returns the completed row to replay, takes over an expired or abandoned claim (returns
   * null), or throws: 422 for the same key with a different body, 409 while still in progress.
   */
  private async claim(data: ClaimKey, requestHash: string) {
    const fresh = () => ({
      responseBody: {},
      statusCode: IN_PROGRESS,
      requestHash,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + TTL_MS),
    });
    try {
      await this.prisma.idempotencyKey.create({ data: { ...data, ...fresh() } });
      return null;
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
    }

    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key_clientId_path: data } });
    // Row vanished between insert and read (the original request failed and released it).
    if (!existing) throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'A request with this Idempotency-Key is still in progress' });

    const now = Date.now();
    const expired = existing.expiresAt.getTime() <= now;
    if (!expired) {
      // Legacy rows have no hash — nothing to compare.
      if (existing.requestHash && existing.requestHash !== requestHash) {
        throw new UnprocessableEntityException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Idempotency-Key was already used with a different request body',
        });
      }
      if (existing.statusCode !== IN_PROGRESS) return existing;
      if (existing.createdAt.getTime() > now - STALE_CLAIM_MS) {
        throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'A request with this Idempotency-Key is still in progress' });
      }
    }

    // Expired (cleanup cron not run yet) or abandoned: compare-and-set on the row we read, so
    // only one of several concurrent retries wins the takeover.
    const { count } = await this.prisma.idempotencyKey.updateMany({
      where: { id: existing.id, statusCode: existing.statusCode, createdAt: existing.createdAt },
      data: fresh(),
    });
    if (count !== 1) throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'A request with this Idempotency-Key is still in progress' });
    return null;
  }
}
