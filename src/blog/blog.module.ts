import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlogService } from './blog.service';
import { BlogController } from './blog.controller';
import { BlogPublicController } from './blog-public.controller';
import { ApiKeyGuard } from '../articles/guards/api-key.guard';
import { ContentPackImportService } from './content-pack-import.service';

@Module({
  imports: [AuthModule],
  controllers: [BlogController, BlogPublicController],
  providers: [BlogService, ApiKeyGuard, ContentPackImportService],
  exports: [BlogService, ContentPackImportService],
})
export class BlogModule {}
