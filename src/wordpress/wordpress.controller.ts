import { Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WordpressPublishService } from './wordpress-publish.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('wordpress')
export class WordpressController {
  constructor(private readonly wordpressPublish: WordpressPublishService) {}

  @Post('sync-now')
  @Roles(UserRole.ADMIN)
  syncNow() {
    return this.wordpressPublish.syncNow();
  }
}
