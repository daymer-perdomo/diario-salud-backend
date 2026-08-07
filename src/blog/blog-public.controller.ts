import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { BlogService } from './blog.service';
import { QueryPublicBlogPostsDto } from './dto/query-public-blog-posts.dto';
import { ApiKeyGuard } from '../articles/guards/api-key.guard';

/// API publica de solo lectura para el contenido de Blog (distinto de
/// Articles/Diario de la Salud). Mismo patron y misma clave (X-API-Key /
/// PUBLIC_API_KEY) que la API publica de articulos, para que WordPress use
/// una sola credencial contra ambos endpoints -- ver ApiKeyGuard.
@ApiTags('Blog (publico)')
@ApiSecurity('public-api-key')
@UseGuards(ApiKeyGuard)
@Controller('blog/public')
export class BlogPublicController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar posts de blog publicos',
    description: 'Sin filtro de estado -- ver QueryPublicBlogPostsDto.',
  })
  @ApiResponse({ status: 200, description: 'Listado paginado de posts de blog.' })
  @ApiResponse({ status: 401, description: 'X-API-Key ausente o invalida.' })
  findPublicPosts(@Query() query: QueryPublicBlogPostsDto) {
    return this.blogService.findPublicPosts(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle publico de un post de blog (con secciones y FAQs)' })
  @ApiParam({ name: 'id', description: 'UUID del post' })
  @ApiResponse({ status: 200, description: 'Post encontrado.' })
  @ApiResponse({ status: 404, description: 'No existe.' })
  findPublicPost(@Param('id') id: string) {
    return this.blogService.findPublicPostById(id);
  }
}
