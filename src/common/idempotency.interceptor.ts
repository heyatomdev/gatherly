import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, from, throwError } from 'rxjs';
import { catchError, concatMap, switchMap } from 'rxjs/operators';
import { PrismaService } from '@/modules/prisma/prisma.service';

const MAX_KEY_LENGTH = 128;
const TTL_MS = 24 * 60 * 60 * 1000;
// statusCode 0 marks a claimed key whose request is still running
const IN_PROGRESS = 0;

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

    // Claim the key first: the unique constraint makes concurrent same-key requests lose here
    // instead of both running the handler.
    // ponytail: a crash mid-request leaves the claim in place until expiresAt (24h) → 409 on retry.
    return from(this.claim(where.key_clientId_path)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.statusCode === IN_PROGRESS) {
            throw new ConflictException('A request with this Idempotency-Key is still in progress');
          }
          res.status(existing.statusCode);
          return from(Promise.resolve(existing.responseBody));
        }

        return next.handle().pipe(
          concatMap(async (responseBody) => {
            await this.prisma.idempotencyKey
              .update({
                where,
                data: { responseBody: responseBody ?? Prisma.JsonNull, statusCode: res.statusCode },
              })
              .catch((err) => this.logger.warn(`idempotency store failed: ${err.message}`));
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

  /** Inserts the in-progress placeholder. Returns the existing row if the key is already taken. */
  private async claim(data: { key: string; clientId: string; path: string }) {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          ...data,
          responseBody: {},
          statusCode: IN_PROGRESS,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
      return null;
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') throw error;
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { key_clientId_path: data } });
      // Row vanished between insert and read (the original request failed and released it).
      if (!existing) throw new ConflictException('A request with this Idempotency-Key is still in progress');
      return existing;
    }
  }
}
