import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ArticlesService } from './articles.service';
import { QueryApprovedArticlesDto } from './dto/query-approved-articles.dto';
import { ApiKeyGuard } from './guards/api-key.guard';

/// API publica de solo lectura: articulos ya aprobados por un revisor
/// humano (brief seccion 10 -- "nunca se publica nada sin validacion
/// humana"). Autenticada con X-API-Key, no con el JWT del panel, porque
/// esta pensada para un consumidor externo sin cuenta de usuario.
@ApiTags('Articulos (publico)')
@ApiSecurity('public-api-key')
@UseGuards(ApiKeyGuard)
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar articulos aprobados',
    description:
      'Solo articulos con estado VALIDADO o PUBLICADO -- nunca borradores ni estados internos del pipeline.',
  })
  @ApiResponse({ status: 200, description: 'Listado paginado de articulos aprobados.' })
  @ApiResponse({ status: 401, description: 'X-API-Key ausente o invalida.' })
  findApproved(@Query() query: QueryApprovedArticlesDto) {
    return this.articlesService.findApproved(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un articulo aprobado' })
  @ApiParam({ name: 'id', description: 'UUID del articulo' })
  @ApiResponse({ status: 200, description: 'Articulo encontrado.' })
  @ApiResponse({ status: 404, description: 'No existe o no esta aprobado (VALIDADO/PUBLICADO).' })
  findOne(@Param('id') id: string) {
    return this.articlesService.findApprovedById(id);
  }
}
