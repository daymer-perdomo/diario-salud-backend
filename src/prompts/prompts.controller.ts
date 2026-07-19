import { Body, Controller, Get, Param, ParseEnumPipe, Patch, UseGuards } from '@nestjs/common';
import { PromptKey, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PromptsService } from './prompts.service';
import { UpdatePromptDto } from './dto/update-prompt.dto';

/// Panel Guia > "Prompts y reglas de IA" (brief: nada de esto debe vivir
/// hardcodeado en el codigo -- ver comentario en default-prompts.ts).
/// Editar reglas de IA es tan sensible como el catalogo de fuentes, por
/// eso PATCH exige ADMIN igual que SourcesController.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAll() {
    return this.promptsService.findAll();
  }

  @Patch(':key')
  @Roles(UserRole.ADMIN)
  update(
    @Param('key', new ParseEnumPipe(PromptKey)) key: PromptKey,
    @Body() dto: UpdatePromptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.promptsService.update(key, dto.content, user.userId);
  }
}
