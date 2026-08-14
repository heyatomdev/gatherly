import { Module } from '@nestjs/common';
import { BastionModule } from '@/modules/bastion/bastion.module';
import { EventModule } from '@/modules/events/event.module';
import { CategoryModule } from '@/modules/categories/category.module';
import { TagModule } from '@/modules/tags/tag.module';
import { ClientModule } from '@/modules/clients/client.module';
import { AdminEventsController } from './controllers/admin-events.controller';
import { AdminParticipantsController } from './controllers/admin-participants.controller';
import { AdminCategoriesController } from './controllers/admin-categories.controller';
import { AdminTagsController } from './controllers/admin-tags.controller';
import { AdminWebhooksController } from './controllers/admin-webhooks.controller';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';

@Module({
  imports: [BastionModule, EventModule, CategoryModule, TagModule, ClientModule],
  controllers: [
    AdminEventsController,
    AdminParticipantsController,
    AdminCategoriesController,
    AdminTagsController,
    AdminWebhooksController,
  ],
  providers: [AdminThrottlerGuard],
})
export class AdminModule {}
