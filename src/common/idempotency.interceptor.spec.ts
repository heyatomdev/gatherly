import { BadRequestException, ConflictException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  IdempotencyInterceptor,
  STALE_CLAIM_MS,
  hashRequestBody,
} from './idempotency.interceptor';

const prisma = {
  idempotencyKey: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
};
const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
const BODY = { userName: 'Mario', type: 'INLINE' };

function ctx(key: any, body: unknown = BODY) {
  const req = {
    headers: { 'idempotency-key': key },
    client: { id: 'c1' },
    method: 'POST',
    originalUrl: '/events/e1/participants',
    body,
  };
  const res = { statusCode: 201, status: jest.fn() };
  return {
    res,
    context: {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as any,
  };
}

/** An existing row for the same key, as findUnique would return it. */
function existing(over: Record<string, unknown> = {}) {
  return {
    id: 'row1',
    statusCode: 0,
    responseBody: {},
    requestHash: hashRequestBody(BODY),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ...over,
  };
}

describe('IdempotencyInterceptor', () => {
  const interceptor = new IdempotencyInterceptor(prisma as any);
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.idempotencyKey.update.mockResolvedValue({});
    prisma.idempotencyKey.delete.mockResolvedValue({});
  });

  it('claims the key with the body hash, runs the handler once, then stores the response', async () => {
    prisma.idempotencyKey.create.mockResolvedValue({});
    const handler = { handle: jest.fn(() => of({ id: 'p1' })) };
    const { context } = ctx('k1');

    await expect(
      lastValueFrom(interceptor.intercept(context, handler)),
    ).resolves.toEqual({ id: 'p1' });

    expect(prisma.idempotencyKey.create.mock.calls[0][0].data).toMatchObject({
      key: 'k1',
      path: 'POST /events/e1/participants',
      statusCode: 0,
      requestHash: hashRequestBody(BODY),
    });
    expect(prisma.idempotencyKey.update.mock.calls[0][0].data).toEqual({
      responseBody: { id: 'p1' },
      statusCode: 201,
    });
  });

  it('hashes bodies independently of key order', () => {
    expect(hashRequestBody({ a: 1, b: { c: [1, { d: 2, e: 3 }] } })).toBe(
      hashRequestBody({ b: { c: [1, { e: 3, d: 2 }] }, a: 1 }),
    );
    expect(hashRequestBody({ a: 1 })).not.toBe(hashRequestBody({ a: 2 }));
    expect(hashRequestBody(undefined)).toBe(hashRequestBody(null));
  });

  it('returns 409 without running the handler while the same key is in progress', async () => {
    prisma.idempotencyKey.create.mockRejectedValue(p2002);
    prisma.idempotencyKey.findUnique.mockResolvedValue(existing());
    const handler = { handle: jest.fn() };

    await expect(
      lastValueFrom(interceptor.intercept(ctx('k1').context, handler)),
    ).rejects.toThrow(ConflictException);
    await expect(
      lastValueFrom(interceptor.intercept(ctx('k1').context, handler)),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_IN_PROGRESS' },
    });
    expect(handler.handle).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.updateMany).not.toHaveBeenCalled();
  });

  it('replays a completed response', async () => {
    prisma.idempotencyKey.create.mockRejectedValue(p2002);
    prisma.idempotencyKey.findUnique.mockResolvedValue(
      existing({ statusCode: 201, responseBody: { id: 'p1' } }),
    );
    const handler = { handle: jest.fn() };
    const { context, res } = ctx('k1');

    await expect(
      lastValueFrom(interceptor.intercept(context, handler)),
    ).resolves.toEqual({ id: 'p1' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('replays legacy rows that have no stored hash', async () => {
    prisma.idempotencyKey.create.mockRejectedValue(p2002);
    prisma.idempotencyKey.findUnique.mockResolvedValue(
      existing({
        statusCode: 201,
        responseBody: { id: 'p1' },
        requestHash: null,
      }),
    );

    await expect(
      lastValueFrom(
        interceptor.intercept(ctx('k1', { other: true }).context, {
          handle: jest.fn(),
        }),
      ),
    ).resolves.toEqual({ id: 'p1' });
  });

  it('returns 422 when the key is reused with a different body', async () => {
    prisma.idempotencyKey.create.mockRejectedValue(p2002);
    prisma.idempotencyKey.findUnique.mockResolvedValue(
      existing({ statusCode: 201, responseBody: { id: 'p1' } }),
    );
    const handler = { handle: jest.fn() };

    await expect(
      lastValueFrom(
        interceptor.intercept(
          ctx('k1', { userName: 'Luigi' }).context,
          handler,
        ),
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('takes over an abandoned IN_PROGRESS claim and runs the handler', async () => {
    const stale = existing({
      createdAt: new Date(Date.now() - STALE_CLAIM_MS - 1000),
    });
    prisma.idempotencyKey.create.mockRejectedValue(p2002);
    prisma.idempotencyKey.findUnique.mockResolvedValue(stale);
    prisma.idempotencyKey.updateMany.mockResolvedValue({ count: 1 });
    const handler = { handle: jest.fn(() => of({ id: 'p1' })) };

    await expect(
      lastValueFrom(interceptor.intercept(ctx('k1').context, handler)),
    ).resolves.toEqual({ id: 'p1' });

    // Compare-and-set on the exact row read, so only one concurrent retry wins.
    const { where, data } = prisma.idempotencyKey.updateMany.mock.calls[0][0];
    expect(where).toEqual({
      id: 'row1',
      statusCode: 0,
      createdAt: stale.createdAt,
    });
    expect(data.createdAt.getTime()).toBeGreaterThan(stale.createdAt.getTime());
    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(prisma.idempotencyKey.update.mock.calls[0][0].data.statusCode).toBe(
      201,
    );
  });

  it('returns 409 when another retry won the takeover', async () => {
    prisma.idempotencyKey.create.mockRejectedValue(p2002);
    prisma.idempotencyKey.findUnique.mockResolvedValue(
      existing({ createdAt: new Date(Date.now() - STALE_CLAIM_MS - 1000) }),
    );
    prisma.idempotencyKey.updateMany.mockResolvedValue({ count: 0 });
    const handler = { handle: jest.fn() };

    await expect(
      lastValueFrom(interceptor.intercept(ctx('k1').context, handler)),
    ).rejects.toThrow(ConflictException);
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('treats an expired row as free, even with a different body', async () => {
    prisma.idempotencyKey.create.mockRejectedValue(p2002);
    prisma.idempotencyKey.findUnique.mockResolvedValue(
      existing({
        statusCode: 201,
        requestHash: 'old',
        expiresAt: new Date(Date.now() - 1000),
      }),
    );
    prisma.idempotencyKey.updateMany.mockResolvedValue({ count: 1 });
    const handler = { handle: jest.fn(() => of({ id: 'p2' })) };

    await expect(
      lastValueFrom(interceptor.intercept(ctx('k1').context, handler)),
    ).resolves.toEqual({ id: 'p2' });
    expect(
      prisma.idempotencyKey.updateMany.mock.calls[0][0].data,
    ).toMatchObject({
      statusCode: 0,
      requestHash: hashRequestBody(BODY),
    });
  });

  it('retries a failed store once', async () => {
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.update
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce({});
    const handler = { handle: jest.fn(() => of({ id: 'p1' })) };

    await expect(
      lastValueFrom(interceptor.intercept(ctx('k1').context, handler)),
    ).resolves.toEqual({ id: 'p1' });
    expect(prisma.idempotencyKey.update).toHaveBeenCalledTimes(2);
    expect(prisma.idempotencyKey.delete).not.toHaveBeenCalled();
  });

  it('releases the claim when the store keeps failing, still returning the response', async () => {
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.update.mockRejectedValue(new Error('db down'));
    const handler = { handle: jest.fn(() => of({ id: 'p1' })) };

    await expect(
      lastValueFrom(interceptor.intercept(ctx('k1').context, handler)),
    ).resolves.toEqual({ id: 'p1' });
    expect(prisma.idempotencyKey.delete).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when the handler fails', async () => {
    prisma.idempotencyKey.create.mockResolvedValue({});
    const handler = {
      handle: jest.fn(() => throwError(() => new Error('boom'))),
    };

    await expect(
      lastValueFrom(interceptor.intercept(ctx('k1').context, handler)),
    ).rejects.toThrow('boom');
    expect(prisma.idempotencyKey.delete).toHaveBeenCalled();
  });

  it('rejects keys longer than 128 chars', () => {
    expect(() =>
      interceptor.intercept(ctx('x'.repeat(129)).context, {
        handle: jest.fn(),
      }),
    ).toThrow(BadRequestException);
  });
});
