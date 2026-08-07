import { Injectable, NotFoundException } from '@nestjs/common';
import { BlogFaq, BlogPost, BlogPostSection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryBlogPostsDto } from './dto/query-blog-posts.dto';
import { QueryPublicBlogPostsDto } from './dto/query-public-blog-posts.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { UpdateBlogSectionDto } from './dto/update-blog-section.dto';
import { UpdateBlogFaqDto } from './dto/update-blog-faq.dto';

/// Forma de salida de la API publica -- deliberadamente mas angosta que el
/// modelo Prisma: nunca expone los campos de gobernanza editorial interna
/// (aiGenerationRule, notes, regulatoryLevel, productPolicy,
/// validationRequired, reviewStatus, medicalValidationStatus, sourceFile,
/// sourceRow, etc.), igual que PublicArticle en articles.service.ts.
export interface PublicBlogPost {
  id: string;
  slug: string;
  hub: string;
  subHub: string | null;
  title: string;
  tagPrincipal: string | null;
  tagsSecondary: string[];
  sections: { order: number; heading: string; body: string | null }[];
  faqs: { question: string; answer: string | null }[];
  updatedAt: Date;
}

/// Unico punto de escritura sobre BlogPost/BlogPostSection/BlogFaq desde
/// la API. La importacion masiva desde el Excel maestro (scripts/import-
/// blog-master.ts) escribe directo con Prisma, fuera de este service --
/// es un paso manual y separado, no una ruta HTTP.
@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPosts(query: QueryBlogPostsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      ...(query.hub ? { hub: query.hub } : {}),
      ...(query.draftStatus ? { draftStatus: query.draftStatus } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        orderBy: { globalId: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { sections: true, faqs: true } } },
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async getHubs(): Promise<string[]> {
    const rows = await this.prisma.blogPost.findMany({
      distinct: ['hub'],
      select: { hub: true },
      orderBy: { hub: 'asc' },
    });
    return rows.map((r) => r.hub);
  }

  async findOnePost(id: string) {
    const post = await this.prisma.blogPost.findUnique({
      where: { id },
      include: {
        sections: { orderBy: { order: 'asc' } },
        faqs: { orderBy: { questionNumber: 'asc' } },
      },
    });
    if (!post) throw new NotFoundException(`BlogPost ${id} no encontrado`);
    return post;
  }

  async updatePost(id: string, dto: UpdateBlogPostDto) {
    await this.findOnePost(id);
    return this.prisma.blogPost.update({ where: { id }, data: dto });
  }

  /// `sectionId` se busca filtrando tambien por `postId` -- asi una URL
  /// con el postId equivocado nunca puede editar la seccion de otro post.
  async updateSection(postId: string, sectionId: string, dto: UpdateBlogSectionDto) {
    const section = await this.prisma.blogPostSection.findFirst({ where: { id: sectionId, postId } });
    if (!section) throw new NotFoundException(`Sección ${sectionId} no encontrada en el post ${postId}`);
    return this.prisma.blogPostSection.update({ where: { id: sectionId }, data: dto });
  }

  async updateFaq(postId: string, faqId: string, dto: UpdateBlogFaqDto) {
    const faq = await this.prisma.blogFaq.findFirst({ where: { id: faqId, postId } });
    if (!faq) throw new NotFoundException(`FAQ ${faqId} no encontrada en el post ${postId}`);
    return this.prisma.blogFaq.update({ where: { id: faqId }, data: dto });
  }

  /// Listado paginado de la API publica. Sin filtro de estado -- ver
  /// comentario en QueryPublicBlogPostsDto.
  async findPublicPosts(
    query: QueryPublicBlogPostsDto,
  ): Promise<{ data: PublicBlogPost[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { ...(query.hub ? { hub: query.hub } : {}) };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        include: {
          sections: { orderBy: { order: 'asc' } },
          faqs: { orderBy: { questionNumber: 'asc' } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toPublicBlogPost(row)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /// Detalle publico de un post de blog, con secciones y FAQs ordenadas.
  async findPublicPostById(id: string): Promise<PublicBlogPost> {
    const post = await this.prisma.blogPost.findUnique({
      where: { id },
      include: {
        sections: { orderBy: { order: 'asc' } },
        faqs: { orderBy: { questionNumber: 'asc' } },
      },
    });
    if (!post) throw new NotFoundException(`BlogPost ${id} no encontrado`);
    return this.toPublicBlogPost(post);
  }

  private toPublicBlogPost(post: BlogPost & { sections: BlogPostSection[]; faqs: BlogFaq[] }): PublicBlogPost {
    return {
      id: post.id,
      slug: post.slug,
      hub: post.hub,
      subHub: post.subHub,
      title: post.title,
      tagPrincipal: post.tagPrincipal,
      tagsSecondary: post.tagsSecondary,
      sections: post.sections.map((s) => ({ order: s.order, heading: s.heading, body: s.body })),
      faqs: post.faqs.map((f) => ({ question: f.question, answer: f.answer })),
      updatedAt: post.updatedAt,
    };
  }
}
