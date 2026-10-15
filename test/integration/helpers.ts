import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { BastionJwksService } from '@heyatom/bastion-client/nest';
import { AppModule } from '@/modules/app/app.module';
import { PrismaService } from '@/modules/prisma/prisma.service';

/**
 * Boots the real AppModule against the Testcontainers DB. Only JWKS is faked:
 * the bearer token *is* the tenantId, verified into a service-client payload,
 * so the real BastionJwtGuard still does the tenant → Client lookup.
 */
export async function bootApp() {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BastionJwksService)
    .useValue({
      getJwks: jest.fn(),
      verify: jest.fn(async (token: string) => ({
        type: 'service_client',
        serviceSlug: 'gatherly',
        clientName: token,
        tenantId: token,
        scopes: [],
        iat: 0,
        exp: 9999999999,
      })),
    })
    .compile();

  const app: INestApplication = module.createNestApplication({ logger: false });
  // Same pipe options as main.ts.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // A real listener: supertest against a bare server starts one per request,
  // and 20 of those at once reset each other's connections.
  await app.listen(0, '127.0.0.1');
  return { app, url: await app.getUrl(), prisma: module.get(PrismaService) };
}

/** A tenant with its own Client row; `auth` is the header that authenticates as it. */
export async function createTenant(prisma: PrismaService) {
  const tenantId = `tenant-${randomUUID()}`;
  const client = await prisma.client.create({
    data: { name: tenantId, token: randomUUID(), tenantId },
  });
  return { client, auth: { Authorization: `Bearer ${tenantId}` } };
}

export function createEvent(
  prisma: PrismaService,
  clientId: string,
  data: Partial<{
    status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
    maxParticipants: number | null;
    startTime: Date;
    endTime: Date | null;
  }> = {},
) {
  return prisma.event.create({
    data: {
      clientId,
      authorId: 'author-1',
      authorName: 'Author',
      status: 'PUBLISHED',
      startTime: new Date(Date.now() + 86_400_000),
      ...data,
      translations: { create: [{ locale: 'it', title: 'Evento' }] },
    },
  });
}
