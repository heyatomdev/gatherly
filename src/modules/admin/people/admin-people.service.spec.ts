import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AdminPeopleService } from './admin-people.service';
import { PeopleQueryDto } from './dto/people-query.dto';

describe('AdminPeopleService.listPeople pagination', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new AdminPeopleService(
    prisma as unknown as PrismaService,
    // The validated config always carries these (defaults in config.validation.ts).
    {
      getOrThrow: (key: string) =>
        ({ VIP_THRESHOLD: 5, AT_RISK_DAYS: 120 })[key],
    } as unknown as ConfigService,
  );

  it('pages the raw query with LIMIT/OFFSET from PageParams and builds meta with paginate()', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { key: 'k', display_name: 'A', total_count: 25 },
    ]);
    // As the global ValidationPipe delivers it: query strings, transformed to an instance.
    const query = plainToInstance(PeopleQueryDto, { page: '2', limit: '10' });

    const result = await service.listPeople('c1', query);

    // Tagged template call: [strings, ...values]; LIMIT and OFFSET are the last two values.
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toMatch(/LIMIT \? OFFSET \?\s*$/);
    expect(values.slice(-2)).toEqual([10, 10]);
    expect(result.meta).toEqual({
      total: 25,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
    expect(result.data[0]).toMatchObject({ key: 'k', displayName: 'A' });
  });

  it('hands out an opaque, client-scoped key instead of the email', async () => {
    prisma.$queryRaw.mockClear();
    prisma.$queryRaw.mockResolvedValue([]);
    await service.listPeople('c1', plainToInstance(PeopleQueryDto, {}));
    // The key column is a nested Prisma.Sql fragment, right before `AS key`.
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    const i = strings.findIndex((part: string) =>
      part.trimStart().startsWith('AS key'),
    );
    expect(values[i - 1].sql).toMatch(
      /^'p_' \|\| left\(encode\(sha256\(convert_to\(/,
    );
    expect(values[i - 1].values[0]).toBe('c1');
  });

  it('does not echo the key in a not-found error', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(
      service.getPersonProfile('c1', 'email:someone@example.com'),
    ).rejects.toThrow(/^Person not found$/);
  });
});
