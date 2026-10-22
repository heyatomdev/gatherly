import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CategoryService } from './category.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryResponseDto,
} from './dto/category.dto';
import { ApiTags, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

@ApiTags('categories')
@Controller('categories')
export class CategoryController {
  constructor(private categoryService: CategoryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CategoryResponseDto })
  async createCategory(
    @Request() req,
    @Body() createCategoryDto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.createCategory(
      req.client.id,
      createCategoryDto,
    );
  }

  @Get()
  @ApiOkResponse({ type: [CategoryResponseDto] })
  async getCategories(@Request() req): Promise<CategoryResponseDto[]> {
    return this.categoryService.getCategoriesByClient(req.client.id);
  }

  @Get(':categoryId')
  @ApiOkResponse({ type: CategoryResponseDto })
  async getCategory(
    @Request() req,
    @Param('categoryId') categoryId: string,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.getCategoryById(categoryId, req.client.id);
  }

  @Patch(':categoryId')
  @ApiOkResponse({ type: CategoryResponseDto })
  async updateCategory(
    @Request() req,
    @Param('categoryId') categoryId: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoryService.updateCategory(
      categoryId,
      req.client.id,
      updateCategoryDto,
    );
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
