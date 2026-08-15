import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagDto, UpdateTagDto } from './dto/tag.dto';

@Injectable()
export class TagService {
  constructor(private prisma: PrismaService) {}

  async createTag(clientId: string, data: CreateTagDto) {
    const slug = data.slug.toLowerCase().trim();

    try {
      return await this.prisma.tag.create({
        data: { clientId, slug, label: data.label },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException(`Tag "${slug}" already exists for this client`);
      }
      throw error;
    }
  }

  async getTagsByClient(clientId: string, withUsage = false) {
    return this.prisma.tag.findMany({
      where: { clientId },
      orderBy: { slug: 'asc' },
      ...(withUsage ? { include: { _count: { select: { events: true } } } } : {}),
    });
  }

  async getTagById(tagId: string, clientId: string) {
    const tag = await this.prisma.tag.findFirst({ where: { id: tagId, clientId } });
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

  async getTagEvents(tagId: string, clientId: string) {
    await this.getTagById(tagId, clientId);
    return this.prisma.eventTag.findMany({
      where: { tagId },
      include: {
        event: {
          include: { translations: true },
        },
      },
    });
  }
}
