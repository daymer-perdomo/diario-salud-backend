import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ArticlesService } from './articles.service';
import { QueryApprovedArticlesDto } from './dto/query-approved-articles.dto';
import { ApiKeyGuard } from './guards/api-key.guard';

/// API publica de solo lectura: articulos ya aprobados por un revisor
/// humano (brief seccion 10 -- "nunca se publica nada sin validacion
/// humana"). Autenticada con X-API-Key, no con el JWT del panel, porque
/// esta pensada para un consumidor externo sin cuenta de usuario.
@UseGuards(ApiKeyGuard)
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  findApproved(@Query() query: QueryApprovedArticlesDto) {
    return this.articlesService.findApproved(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.articlesService.findApprovedById(id);
  }
}
