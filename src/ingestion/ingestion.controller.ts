import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { IngestionDispatcher } from './ingestion.dispatcher';
import { IngestionRunsService } from './ingestion-runs.service';
import { ScheduleRunDto } from './dto/schedule-run.dto';

@ApiTags('Ingesta')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ingestion')
export class IngestionController {
  constructor(
    private readonly dispatcher: IngestionDispatcher,
    private readonly runsService: IngestionRunsService,
  ) {}

  /// Boton "Correr ahora" del panel (header y pestana Cola). Restringido a
  /// ADMIN/EDITOR porque cada disparo consume creditos de IA reales
  /// (ver incidente de agotamiento de credito, 2026-07-12) -- VALIDATOR/
  /// VIEWER solo revisan contenido, no deciden cuando gastar presupuesto.
  @Post('trigger-all')
  @ApiOperation({ summary: 'Ingerir ahora todas las fuentes activas', description: 'Consume credito real de IA.' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  triggerAll(@CurrentUser() user: AuthenticatedUser) {
    return this.dispatcher.triggerAll(user.userId);
  }

  /// Boton "Buscar otras 3" del panel (por fuente, no dispara las demas).
  /// Mismo rol que trigger-all -- consume creditos de IA reales cuando lo
  /// que se traiga avance a scoring, igual que cualquier otro disparo de
  /// ingesta.
  @Post('fetch-more/:sourceId')
  @ApiOperation({ summary: 'Buscar items adicionales de una sola fuente', description: 'Consume credito real de IA.' })
  @ApiParam({ name: 'sourceId' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  fetchMore(@Param('sourceId') sourceId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatcher.fetchMore(sourceId, user.userId);
  }

  /// Historial de corridas (manual, programada y automatica) para la
  /// pestana Cola de validacion. Visible para todos los roles que ya ven
  /// esa pestana -- programar/cancelar si queda restringido a ADMIN/EDITOR.
  @Get('runs')
  @ApiOperation({ summary: 'Historial de corridas de ingesta (manual, programada, automatica)' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  listRuns() {
    return this.runsService.listRecent();
  }

  @Post('schedule')
  @ApiOperation({ summary: 'Programar una corrida de ingesta a futuro' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  schedule(@Body() dto: ScheduleRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.runsService.schedule(new Date(dto.runAt), user.userId);
  }

  @Delete('schedule/:id')
  @ApiOperation({ summary: 'Cancelar una corrida programada' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  cancel(@Param('id') id: string) {
    return this.runsService.cancel(id);
  }
}
