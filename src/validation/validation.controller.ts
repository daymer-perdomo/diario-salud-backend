import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ValidationService } from './validation.service';
import { ValidateArticleDto } from './dto/validate-article.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('validation')
export class ValidationController {
  constructor(private readonly validationService: ValidationService) {}

  @Get('queue')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getQueue() {
    return this.validationService.getReviewQueue();
  }

  @Get('triage')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getTriage() {
    return this.validationService.getTriageQueue();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getDetail(@Param('id') id: string) {
    return this.validationService.getDetail(id);
  }

  @Post(':id/validate')
  @Roles(UserRole.ADMIN, UserRole.VALIDATOR)
  validate(
    @Param('id') id: string,
    @Body() dto: ValidateArticleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.validationService.validate(id, user.userId, dto);
  }

  @Post(':id/regenerate')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR)
  regenerate(@Param('id') id: string) {
    return this.validationService.regenerate(id);
  }
}
