import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RewriteSelectionService } from './rewrite-selection.service';

@ApiTags('Reescritura')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rewrite')
export class RewriteController {
  constructor(private readonly selection: RewriteSelectionService) {}

  /// Boton "Seleccionar mejores ahora" del panel. Restringido a
  /// ADMIN/EDITOR por la misma razon que IngestionController.triggerAll:
  /// esto encola articulos a rewrite/grounding/compliance, todas etapas
  /// con llamadas reales a la API de Gemini.
  @Post('select-top')
  @ApiOperation({
    summary: 'Seleccionar y reescribir los mejores articulos evaluados ahora',
    description: 'Consume credito real de IA (rewrite/grounding/compliance).',
  })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  selectTopNow() {
    return this.selection.runSelection();
  }
}
