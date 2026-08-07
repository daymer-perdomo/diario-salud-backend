import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WordpressPublishService } from './wordpress-publish.service';

@ApiTags('WordPress (espejo)')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('wordpress')
export class WordpressController {
  constructor(private readonly wordpressPublish: WordpressPublishService) {}

  @Post('sync-now')
  @ApiOperation({ summary: 'Sincronizar articulos publicados hacia WordPress ahora' })
  @Roles(UserRole.ADMIN)
  syncNow() {
    return this.wordpressPublish.syncNow();
  }
}
