import { Injectable, NotFoundException } from '@nestjs/common';
import { PageParams } from '@heyatom/nest-common';
import { PrismaService } from '../prisma/prisma.service';
import { EventService } from '../events/event.service';
import { GetEventsQueryDto } from '../events/dto/event.dto';
import { CreateTagDto, UpdateTagDto } from './dto/tag.dto';

@Injectable()
export class TagService {
  constructor(
    private prisma: PrismaService,
    private events: EventService,
  ) {}

  async createTag(clientId: string, data: CreateTagDto) {
    const slug = data.slug.toLowerCase().trim();

    // Duplicate slug → P2002 → 409 CONFLICT via AllExceptionsFilter.
    return this.prisma.tag.create({
      data: { clientId, slug, label: data.label },
    });
  }

  async getTagsByClient(clientId: string, withUsage = false) {
    return this.prisma.tag.findMany({
      where: { clientId },
      orderBy: { slug: 'asc' },
      ...(withUsage
        ? { include: { _count: { select: { events: true } } } }
        : {}),
    });
  }

  async getTagById(tagId: string, clientId: string) {
    const tag = await this.prisma.tag.findFirst({
      where: { id: tagId, clientId },
    });
    if (!tag) throw new NotFoundException(`Tag ${tagId} not found`);
    return tag;
  }

  async updateTag(tagId: string, clientId: string, data: UpdateTagDto) {
    await this.getTagById(tagId, clientId);
    return this.prisma.tag.update({
      where: { id: tagId },
      data: { label: data.label },
    });
  }

  async deleteTag(tagId: string, clientId: string) {
    await this.getTagById(tagId, clientId);
    await this.prisma.tag.delete({ where: { id: tagId } });
  }

  /** Same list as GET /events?tagId=, so the same DTO and ordering. */
  async getTagEvents(tagId: string, clientId: string, page: PageParams) {
    await this.getTagById(tagId, clientId);
    // Assign onto a DTO instance: a spread would lose PageParams' skip getter.
    const query = Object.assign(new GetEventsQueryDto(), {
      page: page.page,
      limit: page.limit,
      tagId,
    });
    return this.events.getEventsByClient(clientId, query);
  }
}
