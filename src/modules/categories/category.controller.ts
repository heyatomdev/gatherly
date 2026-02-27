import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CategoryService } from './category.service';
import { ClientAuthGuard } from '@/guards/client-auth.guard';
import { CreateCategoryDto, UpdateCategoryDto, CategoryResponseDto } from './dto/category.dto';

@Controller('categories')
@UseGuards(ClientAuthGuard)
export class CategoryController {
  constructor(private categoryService: CategoryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createCategory(
    @Request() req,
    @Body() createCategoryDto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.createCategory(req.client.id, createCategoryDto);
  }

  @Get()
  async getCategories(@Request() req): Promise<CategoryResponseDto[]> {
    return this.categoryService.getCategoriesByClient(req.client.id);
  }

  @Get(':categoryId')
  async getCategory(
    @Request() req,
    @Param('categoryId') categoryId: string,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.getCategoryById(categoryId, req.client.id);
  }

  @Patch(':categoryId')
  async updateCategory(
    @Request() req,
    @Param('categoryId') categoryId: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.updateCategory(categoryId, req.client.id, updateCategoryDto);
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(
    @Request() req,
    @Param('categoryId') categoryId: string,
  ): Promise<void> {
    return this.categoryService.deleteCategory(categoryId, req.client.id);
  }
}

