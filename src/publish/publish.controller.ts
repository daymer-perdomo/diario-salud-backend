import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PublishService } from './publish.service';

@ApiTags('Publicacion')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('publish')
export class PublishController {
  constructor(private readonly publishService: PublishService) {}

  @Get('queue')
  @ApiOperation({ summary: 'Listar articulos validados listos para publicar' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getQueue() {
    return this.publishService.getPublishQueue();
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publicar un articulo ya validado' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.VALIDATOR)
  publish(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.publishService.publish(id, user.userId);
  }
}
