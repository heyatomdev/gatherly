import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BastionUserGuard } from '@/modules/bastion/guards/bastion-user.guard';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';
import { AdminPeopleService } from './admin-people.service';
import { PeopleQueryDto } from './dto/people-query.dto';

@ApiTags('admin/people')
@ApiBearerAuth()
@UseGuards(BastionUserGuard, AdminThrottlerGuard)
@Controller('admin/people')
export class AdminPeopleController {
  constructor(private readonly people: AdminPeopleService) {}

  @Get()
  list(@Request() req, @Query() query: PeopleQueryDto) {
    return this.people.listPeople(req.adminClient.id, query);
  }

  @Get(':key')
  profile(@Request() req, @Param('key') key: string) {
    return this.people.getPersonProfile(req.adminClient.id, decodeURIComponent(key));
  }
}
