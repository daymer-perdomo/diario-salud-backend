import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { SourcesService } from './sources.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';

/// Todo el CRUD del catalogo de fuentes exige ADMIN -- es la aplicacion
/// concreta del requisito "whitelist cerrado, no editable por la IA".
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sources')
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAll() {
    return this.sourcesService.findAll();
  }

  /// Antes de ':id' a proposito -- si no, Nest interpreta "stats" como un
  /// :id literal y esta ruta nunca se alcanza.
  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getStats() {
    return this.sourcesService.getStats();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.sourcesService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateSourceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sourcesService.create(dto, user.userId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateSourceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sourcesService.update(id, dto, user.userId);
  }

  @Patch(':id/active')
  @Roles(UserRole.ADMIN)
  setActive(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sourcesService.setActive(id, isActive, user.userId);
  }
}
