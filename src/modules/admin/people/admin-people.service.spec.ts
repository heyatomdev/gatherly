import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from '@/modules/prisma/prisma.service';
import { AdminPeopleService } from './admin-people.service';
import { PeopleQueryDto } from './dto/people-query.dto';

describe('AdminPeopleService.listPeople pagination', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new AdminPeopleService(
    prisma as unknown as PrismaService,
    { get: () => undefined } as unknown as ConfigService,
  );

  it('pages the raw query with LIMIT/OFFSET from PageParams and builds meta with paginate()', async () => {
    prisma.$queryRaw.mockResolvedValue([{ key: 'k', display_name: 'A', total_count: 25 }]);
    // As the global ValidationPipe delivers it: query strings, transformed to an instance.
    const query = plainToInstance(PeopleQueryDto, { page: '2', limit: '10' });

    const result = await service.listPeople('c1', query);

    // Tagged template call: [strings, ...values]; LIMIT and OFFSET are the last two values.
    const [strings, ...values] = prisma.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toMatch(/LIMIT \? OFFSET \?\s*$/);
    expect(values.slice(-2)).toEqual([10, 10]);
    expect(result.meta).toEqual({ total: 25, page: 2, limit: 10, totalPages: 3 });
    expect(result.data[0]).toMatchObject({ key: 'k', displayName: 'A' });
  });
});
