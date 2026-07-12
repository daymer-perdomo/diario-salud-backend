import { Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IngestionDispatcher } from './ingestion.dispatcher';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly dispatcher: IngestionDispatcher) {}

  /// Boton global "Consultar fuentes ahora" del panel. Restringido a
  /// ADMIN/EDITOR porque cada disparo consume creditos de IA reales
  /// (ver incidente de agotamiento de credito, 2026-07-12) -- VALIDATOR/
  /// VIEWER solo revisan contenido, no deciden cuando gastar presupuesto.
  @Post('trigger-all')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  triggerAll() {
    return this.dispatcher.triggerAll();
  }
}
