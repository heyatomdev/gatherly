import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { CategoryService } from '@/modules/categories/category.service';
import { CreateCategoryDto, UpdateCategoryDto } from '@/modules/categories/dto/category.dto';

@ApiTags('admin/categories')
@ApiBearerAuth()
@Controller('admin/categories')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminCategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  list(@Request() req) {
    return this.categories.getCategoriesByClient(req.adminClient.id);
  }

  @Get(':id')
  get(@Request() req, @Param('id') id: string) {
    return this.categories.getCategoryById(id, req.adminClient.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req, @Body() dto: CreateCategoryDto) {
    return this.categories.createCategory(req.adminClient.id, dto);
  }

  @Patch(':id')
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.updateCategory(id, req.adminClient.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req, @Param('id') id: string) {
    return this.categories.deleteCategory(id, req.adminClient.id);
  }
}
