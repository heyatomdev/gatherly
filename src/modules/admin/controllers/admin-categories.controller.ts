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
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiQuery,
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { CategoryService } from '@/modules/categories/category.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryResponseDto,
} from '@/modules/categories/dto/category.dto';

@ApiTags('admin/categories')
@ApiBearerAuth()
@Controller('admin/categories')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminCategoriesController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @ApiOkResponse({ type: [CategoryResponseDto] })
  @ApiQuery({
    name: 'withUsage',
    required: false,
    type: Boolean,
    description: 'Include event count per category',
  })
  list(@Request() req, @Query('withUsage') _withUsage?: string) {
    return this.categories.getCategoriesByClient(req.adminClient.id);
  }

  @Get(':id')
  @ApiOkResponse({ type: CategoryResponseDto })
  get(@Request() req, @Param('id') id: string) {
    return this.categories.getCategoryById(id, req.adminClient.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: CategoryResponseDto })
  create(@Request() req, @Body() dto: CreateCategoryDto) {
    return this.categories.createCategory(req.adminClient.id, dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: CategoryResponseDto })
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.updateCategory(id, req.adminClient.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req, @Param('id') id: string) {
    return this.categories.deleteCategory(id, req.adminClient.id);
  }
}
