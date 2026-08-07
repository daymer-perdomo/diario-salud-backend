import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BlogFaq, BlogPost, BlogPostSection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryBlogPostsDto } from './dto/query-blog-posts.dto';
import { QueryPublicBlogPostsDto } from './dto/query-public-blog-posts.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { UpdateBlogSectionDto } from './dto/update-blog-section.dto';
import { UpdateBlogFaqDto } from './dto/update-blog-faq.dto';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { CreateBlogSectionDto } from './dto/create-blog-section.dto';
import { CreateBlogFaqDto } from './dto/create-blog-faq.dto';

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
  publishedAt: Date | null;
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

  /// Crea un post desde cero (panel), sin pasar por el import del Excel.
  /// `globalId` es NOT NULL + unique en el schema porque normalmente
  /// traza la fila de origen en BLOG_MASTER -- para un post creado a mano
  /// no hay una fila de Excel que trazar, asi que se genera uno sintetico
  /// (prefijo "panel-") solo para satisfacer la restriccion, no como
  /// referencia real a nada. `slug` sale del titulo si no se puede derivar
  /// de otra forma; unicidad de slug no esta forzada en el schema, asi que
  /// dos posts con el mismo titulo tendran el mismo slug -- aceptable para
  /// este alcance, se puede editar a mano despues via updatePost.
  async createPost(dto: CreateBlogPostDto) {
    const slug = this.slugify(dto.title);
    return this.prisma.blogPost.create({
      data: {
        globalId: `panel-${randomUUID()}`,
        title: dto.title,
        slug,
        hub: dto.hub,
        subHub: dto.subHub,
        tagPrincipal: dto.tagPrincipal,
        tagsSecondary: dto.tagsSecondary ?? [],
      },
    });
  }

  /// Agrega una seccion (H2) nueva al final del post -- a diferencia del
  /// import del Excel, que trae todas las secciones de una vez con su
  /// `order` ya definido, un post creado a mano las va agregando una por
  /// una desde el panel.
  async addSection(postId: string, dto: CreateBlogSectionDto) {
    await this.findOnePost(postId);
    const last = await this.prisma.blogPostSection.findFirst({
      where: { postId },
      orderBy: { order: 'desc' },
    });
    return this.prisma.blogPostSection.create({
      data: { postId, order: (last?.order ?? 0) + 1, heading: dto.heading, body: dto.body },
    });
  }

  async addFaq(postId: string, dto: CreateBlogFaqDto) {
    await this.findOnePost(postId);
    return this.prisma.blogFaq.create({
      data: { postId, question: dto.question, answer: dto.answer },
    });
  }

  /// Unico camino que hace que un post aparezca en GET /blog/public (y por
  /// lo tanto en WordPress via [diario_blog]) -- ver findPublicPosts.
  /// Accion explicita y separada de crear/editar, a proposito: nada se
  /// publica solo por guardar cambios.
  async publishPost(id: string) {
    await this.findOnePost(id);
    return this.prisma.blogPost.update({
      where: { id },
      data: { published: true, publishedAt: new Date() },
    });
  }

  async unpublishPost(id: string) {
    await this.findOnePost(id);
    return this.prisma.blogPost.update({
      where: { id },
      data: { published: false, publishedAt: null },
    });
  }

  /// Listado paginado de la API publica -- solo posts publicados a mano
  /// desde el panel (ver publishPost). Sin esto, cualquier post recien
  /// creado o a medio redactar apareceria en WordPress de inmediato.
  async findPublicPosts(
    query: QueryPublicBlogPostsDto,
  ): Promise<{ data: PublicBlogPost[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = { published: true, ...(query.hub ? { hub: query.hub } : {}) };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        include: {
          sections: { orderBy: { order: 'asc' } },
          faqs: { orderBy: { questionNumber: 'asc' } },
        },
        orderBy: { publishedAt: 'desc' },
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

  /// Detalle publico de un post de blog. 404 tanto si no existe como si
  /// existe pero no esta publicado -- mismo criterio que Articles
  /// (findApprovedById), para no revelar que un post en borrador existe.
  async findPublicPostById(id: string): Promise<PublicBlogPost> {
    const post = await this.prisma.blogPost.findUnique({
      where: { id },
      include: {
        sections: { orderBy: { order: 'asc' } },
        faqs: { orderBy: { questionNumber: 'asc' } },
      },
    });
    if (!post || !post.published) throw new NotFoundException(`BlogPost ${id} no encontrado`);
    return this.toPublicBlogPost(post);
  }

  private slugify(title: string): string {
    return (
      title
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || randomUUID()
    );
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
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
    };
  }
}
