import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BlogService } from './blog.service';
import { QueryBlogPostsDto } from './dto/query-blog-posts.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { UpdateBlogSectionDto } from './dto/update-blog-section.dto';
import { UpdateBlogFaqDto } from './dto/update-blog-faq.dto';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { CreateBlogSectionDto } from './dto/create-blog-section.dto';
import { CreateBlogFaqDto } from './dto/create-blog-faq.dto';

/// Lectura abierta a los 4 roles (igual que sources/articles) -- la
/// escritura (redactar contenido) exige ADMIN o EDITOR. VALIDATOR se
/// reutiliza para toda validacion (medica y farmaceutica) por ahora --
/// ver plan: no hay todavia pantalla de validacion, asi que no tiene
/// endpoints de escritura propios en este corte.
@ApiTags('Blog')
@ApiBearerAuth('jwt')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Post('posts')
  @ApiOperation({ summary: 'Crear un post de blog desde cero (nace sin publicar)' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  createPost(@Body() dto: CreateBlogPostDto) {
    return this.blogService.createPost(dto);
  }

  @Get('posts')
  @ApiOperation({ summary: 'Listar posts de blog (paginado, filtrable por hub/estado)' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAllPosts(@Query() query: QueryBlogPostsDto) {
    return this.blogService.findAllPosts(query);
  }

  @Get('hubs')
  @ApiOperation({ summary: 'Listar valores distintos de hub/taxonomia' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getHubs() {
    return this.blogService.getHubs();
  }

  @Get('posts/:id')
  @ApiOperation({ summary: 'Detalle de un post (con secciones y FAQs)' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findOnePost(@Param('id') id: string) {
    return this.blogService.findOnePost(id);
  }

  @Patch('posts/:id')
  @ApiOperation({ summary: 'Editar titulo/slug/estado de un post' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updatePost(@Param('id') id: string, @Body() dto: UpdateBlogPostDto) {
    return this.blogService.updatePost(id, dto);
  }

  @Patch('posts/:id/sections/:sectionId')
  @ApiOperation({ summary: 'Editar el cuerpo de una seccion (H2) del post' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'sectionId' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updateSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateBlogSectionDto,
  ) {
    return this.blogService.updateSection(id, sectionId, dto);
  }

  @Patch('posts/:id/faqs/:faqId')
  @ApiOperation({ summary: 'Editar la respuesta de una FAQ del post' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'faqId' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updateFaq(@Param('id') id: string, @Param('faqId') faqId: string, @Body() dto: UpdateBlogFaqDto) {
    return this.blogService.updateFaq(id, faqId, dto);
  }

  @Post('posts/:id/sections')
  @ApiOperation({ summary: 'Agregar una seccion (H2) nueva al final del post' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  addSection(@Param('id') id: string, @Body() dto: CreateBlogSectionDto) {
    return this.blogService.addSection(id, dto);
  }

  @Post('posts/:id/faqs')
  @ApiOperation({ summary: 'Agregar una FAQ nueva al post' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  addFaq(@Param('id') id: string, @Body() dto: CreateBlogFaqDto) {
    return this.blogService.addFaq(id, dto);
  }

  @Post('posts/:id/publish')
  @ApiOperation({
    summary: 'Publicar un post -- unica accion que lo hace visible en GET /blog/public (WordPress)',
  })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  publishPost(@Param('id') id: string) {
    return this.blogService.publishPost(id);
  }

  @Post('posts/:id/unpublish')
  @ApiOperation({ summary: 'Despublicar un post -- deja de mostrarse en GET /blog/public' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  unpublishPost(@Param('id') id: string) {
    return this.blogService.unpublishPost(id);
  }
}
