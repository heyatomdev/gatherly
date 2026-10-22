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
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { TagService } from './tag.service';
import { CreateTagDto, UpdateTagDto, TagResponseDto } from './dto/tag.dto';
import { TagEventResponseDto } from '../events/dto/event-response.dto';

@ApiTags('tags')
@Controller('tags')
export class TagController {
  constructor(private tagService: TagService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: TagResponseDto })
  @ApiOperation({ summary: 'Create tag for client' })
  async createTag(@Request() req, @Body() dto: CreateTagDto) {
    return this.tagService.createTag(req.client.id, dto);
  }

  @Get()
  @ApiOkResponse({ type: [TagResponseDto] })
  @ApiOperation({ summary: 'List all tags for client' })
  async getTags(@Request() req) {
    return this.tagService.getTagsByClient(req.client.id);
  }

  @Get(':tagId')
  @ApiOkResponse({ type: TagResponseDto })
  async getTag(@Request() req, @Param('tagId') tagId: string) {
    return this.tagService.getTagById(tagId, req.client.id);
  }

  @Get(':tagId/events')
  @ApiOkResponse({ type: [TagEventResponseDto] })
  @ApiOperation({ summary: 'List events associated with tag' })
  async getTagEvents(@Request() req, @Param('tagId') tagId: string) {
    return this.tagService.getTagEvents(tagId, req.client.id);
  }

  @Patch(':tagId')
  @ApiOkResponse({ type: TagResponseDto })
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
  @ApiOperation({
    summary: 'Delete tag — removed from all events automatically',
  })
  async deleteTag(@Request() req, @Param('tagId') tagId: string) {
    return this.tagService.deleteTag(tagId, req.client.id);
  }
}
