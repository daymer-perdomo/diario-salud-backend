import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PipelineStatusService } from './pipeline-status.service';

/// Solo lectura -- consultado por el panel via polling para el indicador
/// visual de proceso en curso / terminado. Ningun rol queda excluido:
/// es informativo, no dispara ni gasta credito de IA.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pipeline')
export class PipelineStatusController {
  constructor(private readonly pipelineStatusService: PipelineStatusService) {}

  @Get('status')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getStatus() {
    return this.pipelineStatusService.getStatus();
  }
}
