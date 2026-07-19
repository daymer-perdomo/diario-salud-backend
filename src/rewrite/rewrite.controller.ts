import { Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RewriteSelectionService } from './rewrite-selection.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('rewrite')
export class RewriteController {
  constructor(private readonly selection: RewriteSelectionService) {}

  /// Boton "Seleccionar mejores ahora" del panel. Restringido a
  /// ADMIN/EDITOR por la misma razon que IngestionController.triggerAll:
  /// esto encola articulos a rewrite/grounding/compliance, todas etapas
  /// con llamadas reales a la API de Gemini.
  @Post('select-top')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  selectTopNow() {
    return this.selection.runSelection();
  }
}
