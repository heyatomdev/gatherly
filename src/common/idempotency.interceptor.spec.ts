import { BadRequestException, ConflictException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

const prisma = {
  idempotencyKey: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
};
const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });

function ctx(key: any) {
  const req = {
    headers: { 'idempotency-key': key },
    client: { id: 'c1' },
    method: 'POST',
    originalUrl: '/events/e1/participants',
  };
  const res = { statusCode: 201, status: jest.fn() };
  return {
    res,
    context: { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as any,
  };
}

describe('IdempotencyInterceptor', () => {
  const interceptor = new IdempotencyInterceptor(prisma as any);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.idempotencyKey.update.mockResolvedValue({});
    prisma.idempotencyKey.delete.mockResolvedValue({});
  });

  it('claims the key, runs the handler once, then stores the response', async () => {
    prisma.idempotencyKey.create.mockResolvedValue({});
    const handler = { handle: jest.fn(() => of({ id: 'p1' })) };
    const { context } = ctx('k1');

    await expect(lastValueFrom(interceptor.intercept(context, handler))).resolves.toEqual({ id: 'p1' });

    expect(prisma.idempotencyKey.create.mock.calls[0][0].data).toMatchObject({
      key: 'k1',
      path: 'POST /events/e1/participants',
      statusCode: 0,
    });
    expect(prisma.idempotencyKey.update.mock.calls[0][0].data).toEqual({
      responseBody: { id: 'p1' },
      statusCode: 201,
    });
  });

  it('returns 409 without running the handler while the same key is in progress', async () => {
    prisma.idempotencyKey.create.mockRejectedValue(p2002);
    prisma.idempotencyKey.findUnique.mockResolvedValue({ statusCode: 0 });
    const handler = { handle: jest.fn() };

    await expect(lastValueFrom(interceptor.intercept(ctx('k1').context, handler))).rejects.toThrow(
      ConflictException,
    );
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('replays a completed response', async () => {
    prisma.idempotencyKey.create.mockRejectedValue(p2002);
    prisma.idempotencyKey.findUnique.mockResolvedValue({ statusCode: 201, responseBody: { id: 'p1' } });
    const handler = { handle: jest.fn() };
    const { context, res } = ctx('k1');

    await expect(lastValueFrom(interceptor.intercept(context, handler))).resolves.toEqual({ id: 'p1' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('releases the claim when the handler fails', async () => {
    prisma.idempotencyKey.create.mockResolvedValue({});
    const handler = { handle: jest.fn(() => throwError(() => new Error('boom'))) };

    await expect(lastValueFrom(interceptor.intercept(ctx('k1').context, handler))).rejects.toThrow('boom');
    expect(prisma.idempotencyKey.delete).toHaveBeenCalled();
  });

  it('rejects keys longer than 128 chars', () => {
    expect(() => interceptor.intercept(ctx('x'.repeat(129)).context, { handle: jest.fn() })).toThrow(
      BadRequestException,
    );
  });
});
