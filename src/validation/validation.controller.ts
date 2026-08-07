import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ValidationService } from './validation.service';
import { ValidateArticleDto } from './dto/validate-article.dto';

@ApiTags('Validacion')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('validation')
export class ValidationController {
  constructor(private readonly validationService: ValidationService) {}

  @Get('queue')
  @ApiOperation({ summary: 'Cola de revision humana' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getQueue() {
    return this.validationService.getReviewQueue();
  }

  /// Vista unificada (tabla del dashboard con filtro de Estado en el
  /// sidebar) -- union de revision + triage + validado + rechazado +
  /// publicado. Antes de esta ruta el panel pedia queue/triage/publish
  /// por separado y los mostraba en pestanas distintas.
  @Get('all')
  @ApiOperation({ summary: 'Tabla unificada de todos los articulos, cualquier estado' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getAll() {
    return this.validationService.getAllForStaff();
  }

  @Get('triage')
  @ApiOperation({ summary: 'Cola de triage (fallos de fidelidad/cumplimiento previos a revision)' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getTriage() {
    return this.validationService.getTriageQueue();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle completo de un articulo para revision' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getDetail(@Param('id') id: string) {
    return this.validationService.getDetail(id);
  }

  @Post(':id/validate')
  @ApiOperation({ summary: 'Aprobar, rechazar o aprobar-con-edicion un articulo' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.VALIDATOR)
  validate(
    @Param('id') id: string,
    @Body() dto: ValidateArticleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.validationService.validate(id, user.userId, dto);
  }

  @Post(':id/regenerate')
  @ApiOperation({ summary: 'Re-ejecutar reescritura/chequeos de IA sobre un articulo' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR)
  regenerate(@Param('id') id: string) {
    return this.validationService.regenerate(id);
  }
}
