import { Module } from '@nestjs/common';
import { TagService } from './tag.service';
import { TagController } from './tag.controller';
import { ClientAuthGuard } from '@/guards/client-auth.guard';

@Module({
  controllers: [TagController],
  providers: [TagService, ClientAuthGuard],
  exports: [TagService],
})
export class TagModule {}
