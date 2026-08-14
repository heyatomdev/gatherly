import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { PrismaService } from '@/modules/prisma/prisma.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey || !req.client) {
      return next.handle();
    }

    const path = `${req.method} ${req.route?.path ?? req.path}`;
    const clientId = req.client.id;

    return from(
      this.prisma.idempotencyKey.findUnique({
        where: { key_clientId_path: { key: idempotencyKey, clientId, path } },
      }),
    ).pipe(
      switchMap((existing) => {
        if (existing) {
          const res = context.switchToHttp().getResponse();
          res.status(existing.statusCode);
          return from(Promise.resolve(existing.responseBody));
        }

        return next.handle().pipe(
          tap(async (responseBody) => {
            const res = context.switchToHttp().getResponse();
            await this.prisma.idempotencyKey.create({
              data: {
                key: idempotencyKey,
                clientId,
                path,
                responseBody,
                statusCode: res.statusCode,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              },
            });
          }),
        );
      }),
    );
  }
}
