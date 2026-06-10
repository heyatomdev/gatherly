import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryResponseDto } from './dto/category.dto';

const CATEGORY_INCLUDE = {
  translations: true,
  _count: { select: { events: true } },
} as const;

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

  async createCategory(clientId: string, data: CreateCategoryDto): Promise<CategoryResponseDto> {
    return this.prisma.eventCategory.create({
      data: {
        clientId,
        color: data.color,
        icon: data.icon,
        translations: { create: data.translations },
      },
      include: CATEGORY_INCLUDE,
    }) as any;
  }

  async getCategoriesByClient(clientId: string): Promise<CategoryResponseDto[]> {
    return this.prisma.eventCategory.findMany({
      where: { clientId },
      include: CATEGORY_INCLUDE,
    }) as any;
  }

  async getCategoryById(categoryId: string, clientId: string): Promise<CategoryResponseDto> {
    const category = await this.prisma.eventCategory.findFirst({
      where: { id: categoryId, clientId },
      include: CATEGORY_INCLUDE,
    });

    if (!category) throw new NotFoundException('Category not found');

    return category as any;
  }

  async updateCategory(
    categoryId: string,
    clientId: string,
    data: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    await this.getCategoryById(categoryId, clientId);

    if (data.translations?.length) {
      await Promise.all(
        data.translations.map((t) =>
          this.prisma.eventCategoryTranslation.upsert({
            where: { categoryId_locale: { categoryId, locale: t.locale } },
            create: { categoryId, locale: t.locale, name: t.name },
            update: { name: t.name },
          }),
        ),
      );
    }

    return this.prisma.eventCategory.update({
      where: { id: categoryId },
      data: {
        color: data.color,
        icon: data.icon,
      },
      include: CATEGORY_INCLUDE,
    }) as any;
  }

  async deleteCategory(categoryId: string, clientId: string): Promise<void> {
    await this.getCategoryById(categoryId, clientId);
    await this.prisma.eventCategory.delete({ where: { id: categoryId } });
  }
}
