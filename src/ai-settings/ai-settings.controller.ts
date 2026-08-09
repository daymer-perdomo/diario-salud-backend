import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AiSettingsService } from './ai-settings.service';
import { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';

/// Panel Chatbot > "Configuración del modelo de IA". Igual de sensible
/// que editar prompts (PromptsController): PATCH exige ADMIN.
@ApiTags('Configuración de IA')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai-settings')
export class AiSettingsController {
  constructor(private readonly aiSettingsService: AiSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Ver el modelo/API key de IA configurados (nunca la key completa)' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getSettings() {
    return this.aiSettingsService.getPublic();
  }

  @Patch()
  @ApiOperation({ summary: 'Configurar el modelo y/o la API key de Gemini' })
  @Roles(UserRole.ADMIN)
  update(@Body() dto: UpdateAiSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.aiSettingsService.update(dto, user.userId);
  }
}
