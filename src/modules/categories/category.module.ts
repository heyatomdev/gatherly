import { Module } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CategoryController } from './category.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ClientAuthGuard } from '@/guards/client-auth.guard';

@Module({
  controllers: [CategoryController],
  providers: [CategoryService, PrismaService, ClientAuthGuard],
  exports: [CategoryService],
})
export class CategoryModule {}

