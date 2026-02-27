import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryResponseDto } from './dto/category.dto';

@Injectable()
export class CategoryService {
  constructor(private prisma: PrismaService) {}

  async createCategory(
    clientId: string,
    data: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    try {
      return await this.prisma.eventCategory.create({
        data: {
          ...data,
          clientId,
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Category with this name already exists for this client');
      }
      throw error;
    }
  }

  async getCategoriesByClient(clientId: string): Promise<CategoryResponseDto[]> {
    return this.prisma.eventCategory.findMany({
      where: { clientId },
      include: {
        _count: {
          select: { events: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getCategoryById(categoryId: string, clientId: string): Promise<CategoryResponseDto> {
    const category = await this.prisma.eventCategory.findFirst({
      where: { id: categoryId, clientId },
      include: {
        _count: {
          select: { events: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async updateCategory(
    categoryId: string,
    clientId: string,
    data: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    await this.getCategoryById(categoryId, clientId);

    try {
      return await this.prisma.eventCategory.update({
        where: { id: categoryId },
        data,
        include: {
          _count: {
            select: { events: true },
          },
        },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Category with this name already exists for this client');
      }
      throw error;
    }
  }

  async deleteCategory(categoryId: string, clientId: string): Promise<void> {
    await this.getCategoryById(categoryId, clientId);

    await this.prisma.eventCategory.delete({
      where: { id: categoryId },
    });
  }
}

