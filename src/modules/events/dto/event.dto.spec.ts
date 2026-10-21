import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { CreateEventDto, GetEventsQueryDto, UpdateEventDto } from './event.dto';

// Same options as main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const body = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({
  type: 'body',
  metatype,
});

const createBody = {
  translations: [{ locale: 'it', title: 'Evento' }],
  authorId: 'author-1',
  authorName: 'Author',
  startTime: new Date(Date.now() + 86_400_000).toISOString(),
};

describe('event DTOs reject `status` — PUT /publish, /cancel, /complete own the transitions', () => {
  it('accepts a create body without status', async () => {
    await expect(
      pipe.transform(createBody, body(CreateEventDto)),
    ).resolves.toBeInstanceOf(CreateEventDto);
  });

  it.each(['PUBLISHED', 'DRAFT'])(
    'rejects status %s on create',
    async (status) => {
      await expect(
        pipe.transform({ ...createBody, status }, body(CreateEventDto)),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('rejects status on update', async () => {
    await expect(
      pipe.transform({ status: 'PUBLISHED' }, body(UpdateEventDto)),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('GetEventsQueryDto search and sort', () => {
  const query: ArgumentMetadata = {
    type: 'query',
    metatype: GetEventsQueryDto,
  };

  it('trims search and drops a blank one', async () => {
    const trimmed = await pipe.transform({ search: '  tai chi ' }, query);
    expect(trimmed.search).toBe('tai chi');
    const blank = await pipe.transform({ search: '   ' }, query);
    expect(blank.search).toBeUndefined();
  });

  it('rejects a search over 100 chars and an unknown sort field', async () => {
    await expect(
      pipe.transform({ search: 'x'.repeat(101) }, query),
    ).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({ sortBy: 'title' }, query)).rejects.toThrow(
      BadRequestException,
    );
  });
});
