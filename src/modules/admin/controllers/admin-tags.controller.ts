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
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { TagService } from '@/modules/tags/tag.service';
import { CreateTagDto, UpdateTagDto } from '@/modules/tags/dto/tag.dto';

@ApiTags('admin/tags')
@ApiBearerAuth()
@Controller('admin/tags')
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
export class AdminTagsController {
  constructor(private readonly tags: TagService) {}

  @Get()
  @ApiQuery({ name: 'withUsage', required: false, type: Boolean, description: 'Include event count and orphan flag per tag' })
  list(@Request() req, @Query('withUsage') withUsage?: string) {
    return this.tags.getTagsByClient(req.adminClient.id, withUsage === 'true');
  }

  @Get(':id')
  get(@Request() req, @Param('id') id: string) {
    return this.tags.getTagById(id, req.adminClient.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Request() req, @Body() dto: CreateTagDto) {
    return this.tags.createTag(req.adminClient.id, dto);
  }

  @Patch(':id')
  update(@Request() req, @Param('id') id: string, @Body() dto: UpdateTagDto) {
    return this.tags.updateTag(id, req.adminClient.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() req, @Param('id') id: string) {
    return this.tags.deleteTag(id, req.adminClient.id);
  }
}
