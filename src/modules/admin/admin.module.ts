import { Module } from '@nestjs/common';
import { BastionModule } from '@/modules/bastion/bastion.module';
import { EventModule } from '@/modules/events/event.module';
import { CategoryModule } from '@/modules/categories/category.module';
import { TagModule } from '@/modules/tags/tag.module';
import { ClientModule } from '@/modules/clients/client.module';
import { WebhookModule } from '@/modules/webhook/webhook.module';
import { AdminEventsController } from './controllers/admin-events.controller';
import { AdminParticipantsController } from './controllers/admin-participants.controller';
import { AdminCategoriesController } from './controllers/admin-categories.controller';
import { AdminTagsController } from './controllers/admin-tags.controller';
import { AdminWebhooksController } from './controllers/admin-webhooks.controller';
import { AdminAnalyticsController } from './analytics/admin-analytics.controller';
import { AdminPeopleController } from './people/admin-people.controller';
import { AdminAnalyticsService } from './analytics/admin-analytics.service';
import { AdminPeopleService } from './people/admin-people.service';
import { AdminThrottlerGuard } from '@/guards/admin-throttler.guard';

@Module({
  imports: [BastionModule, EventModule, CategoryModule, TagModule, ClientModule, WebhookModule],
  controllers: [
    AdminEventsController,
    AdminParticipantsController,
    AdminCategoriesController,
    AdminTagsController,
    AdminWebhooksController,
    AdminAnalyticsController,
    AdminPeopleController,
  ],
  providers: [AdminThrottlerGuard, AdminAnalyticsService, AdminPeopleService],
})
export class AdminModule {}
