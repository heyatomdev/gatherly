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
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TagService } from './tag.service';
import { ClientAuthGuard } from '@/guards/client-auth.guard';
import { CreateTagDto, UpdateTagDto } from './dto/tag.dto';

@ApiTags('tags')
@Controller('tags')
@UseGuards(ClientAuthGuard)
export class TagController {
  constructor(private tagService: TagService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create tag for client' })
  async createTag(@Request() req, @Body() dto: CreateTagDto) {
    return this.tagService.createTag(req.client.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all tags for client' })
  async getTags(@Request() req) {
    return this.tagService.getTagsByClient(req.client.id);
  }

  @Get(':tagId')
  async getTag(@Request() req, @Param('tagId') tagId: string) {
    return this.tagService.getTagById(tagId, req.client.id);
  }

  @Get(':tagId/events')
  @ApiOperation({ summary: 'List events associated with tag' })
  async getTagEvents(@Request() req, @Param('tagId') tagId: string) {
    return this.tagService.getTagEvents(tagId, req.client.id);
  }

  @Patch(':tagId')
  @ApiOperation({ summary: 'Update tag label (localized)' })
  async updateTag(
    @Request() req,
    @Param('tagId') tagId: string,
    @Body() dto: UpdateTagDto,
  ) {
    return this.tagService.updateTag(tagId, req.client.id, dto);
  }

  @Delete(':tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete tag — removed from all events automatically' })
  async deleteTag(@Request() req, @Param('tagId') tagId: string) {
    return this.tagService.deleteTag(tagId, req.client.id);
  }
}
