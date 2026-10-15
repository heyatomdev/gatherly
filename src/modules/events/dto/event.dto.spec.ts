import {
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { CreateEventDto, UpdateEventDto } from './event.dto';

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
