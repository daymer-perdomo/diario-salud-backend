import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BlogService } from './blog.service';
import { QueryBlogPostsDto } from './dto/query-blog-posts.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { UpdateBlogSectionDto } from './dto/update-blog-section.dto';
import { UpdateBlogFaqDto } from './dto/update-blog-faq.dto';

/// Lectura abierta a los 4 roles (igual que sources/articles) -- la
/// escritura (redactar contenido) exige ADMIN o EDITOR. VALIDATOR se
/// reutiliza para toda validacion (medica y farmaceutica) por ahora --
/// ver plan: no hay todavia pantalla de validacion, asi que no tiene
/// endpoints de escritura propios en este corte.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('blog')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get('posts')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAllPosts(@Query() query: QueryBlogPostsDto) {
    return this.blogService.findAllPosts(query);
  }

  @Get('hubs')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  getHubs() {
    return this.blogService.getHubs();
  }

  @Get('posts/:id')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findOnePost(@Param('id') id: string) {
    return this.blogService.findOnePost(id);
  }

  @Patch('posts/:id')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updatePost(@Param('id') id: string, @Body() dto: UpdateBlogPostDto) {
    return this.blogService.updatePost(id, dto);
  }

  @Patch('posts/:id/sections/:sectionId')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updateSection(
    @Param('id') id: string,
    @Param('sectionId') sectionId: string,
    @Body() dto: UpdateBlogSectionDto,
  ) {
    return this.blogService.updateSection(id, sectionId, dto);
  }

  @Patch('posts/:id/faqs/:faqId')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updateFaq(@Param('id') id: string, @Param('faqId') faqId: string, @Body() dto: UpdateBlogFaqDto) {
    return this.blogService.updateFaq(id, faqId, dto);
  }
}
