import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { BlogFaq, BlogPost, BlogPostSection, BlogReviewDecision, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_ARTICLE_IMAGE_URL } from '../common/default-article-image.util';
import { slugify } from '../common/slugify.util';
import { BLOG_IMAGE_UPLOAD_DIR, blogImagePublicUrl } from './blog-image.storage';
import { QueryBlogPostsDto } from './dto/query-blog-posts.dto';
import { QueryPublicBlogPostsDto } from './dto/query-public-blog-posts.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { UpdateBlogSectionDto } from './dto/update-blog-section.dto';
import { UpdateBlogFaqDto } from './dto/update-blog-faq.dto';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { CreateBlogSectionDto } from './dto/create-blog-section.dto';
import { CreateBlogFaqDto } from './dto/create-blog-faq.dto';
import { CreateBlogReviewDto } from './dto/create-blog-review.dto';

/// El gate de revision (ver publishPost) y la API publica por defecto (ver
/// findPublicPosts) solo aplican a contenido tipo Blog -- `contentType`
/// null cubre los posts legados del Excel maestro viejo (BLOG_MASTER no
/// tenia esta columna), que se tratan como Blog por convencion.
function isBlogTypeContent(contentType: string | null): boolean {
  return contentType === null || contentType.startsWith('BLOG');
}

/// Familias de alto nivel para filtrar por tipo de contenido -- 'HUB'
/// agrupa 'HUB'/'SOUS-HUB', 'BLOG' agrupa 'BLOG'/'BLOG HUB'/'BLOG SOUS-HUB'
/// (+ null, posts legados del Excel maestro), 'ENCICLOPEDIA' agrupa sus 3
/// variantes. Usado tanto por el filtro del panel (findAllPosts) como por
/// el filtro explicito de la API publica (findPublicPosts). Un valor que
/// no calce con ninguna familia conocida se trata como el `contentType`
/// exacto (permite filtrar granular, ej. solo 'BLOG HUB', si hiciera falta).
function contentTypeFamilyWhere(family: string): Prisma.BlogPostWhereInput {
  const upper = family.toUpperCase();
  if (upper === 'HUB') return { contentType: { in: ['HUB', 'SOUS-HUB'] } };
  if (upper === 'ENCICLOPEDIA') return { contentType: { startsWith: 'ENCICLOPEDIA' } };
  if (upper === 'BLOG') return { OR: [{ contentType: null }, { contentType: { startsWith: 'BLOG' } }] };
  return { contentType: family };
}

/// Forma de salida de la API publica -- deliberadamente mas angosta que el
/// modelo Prisma: nunca expone los campos de gobernanza editorial interna
/// (aiGenerationRule, notes, regulatoryLevel, productPolicy,
/// validationRequired, reviewStatus, medicalValidationStatus, sourceFile,
/// sourceRow, etc.), igual que PublicArticle en articles.service.ts.
export interface PublicBlogPost {
  id: string;
  slug: string;
  contentType: string | null;
  hub: string;
  subHub: string | null;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  tagPrincipal: string | null;
  tagsSecondary: string[];
  sections: { order: number; heading: string; body: string | null }[];
  faqs: { question: string; answer: string | null }[];
  imageUrl: string;
  publishedAt: Date | null;
  updatedAt: Date;
}

/// Unico punto de escritura sobre BlogPost/BlogPostSection/BlogFaq desde
/// la API. La importacion masiva (scripts/import-blog-master.ts para el
/// Excel maestro, scripts/import-content-pack.ts para paquetes tipo
/// ENTREGA_TABLAS_SEPARADAS) escribe directo con Prisma, fuera de este
/// service -- es un paso manual y separado, no una ruta HTTP.
@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPosts(query: QueryBlogPostsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.BlogPostWhereInput = {
      ...(query.hub ? { hub: query.hub } : {}),
      ...(query.draftStatus ? { draftStatus: query.draftStatus } : {}),
      ...(query.contentType ? contentTypeFamilyWhere(query.contentType) : {}),
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
    const slug = slugify(dto.title);
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

  /// Aprobar/rechazar un post antes de publicar -- gate real solo para
  /// contenido tipo Blog (ver isBlogTypeContent y publishPost). Hub y
  /// Enciclopedia tambien pueden usarlo si algun dia se decide extenderles
  /// el gate, pero hoy no bloquea nada para ellos.
  async reviewPost(id: string, dto: CreateBlogReviewDto, reviewedByUserId: string | null) {
    await this.findOnePost(id);
    return this.prisma.blogPost.update({
      where: { id },
      data: {
        reviewDecision: dto.decision,
        reviewedByUserId,
        reviewedAt: new Date(),
        reviewNotes: dto.notes ?? null,
      },
    });
  }

  /// Unico camino que hace que un post aparezca en GET /blog/public (y por
  /// lo tanto en WordPress via [diario_blog]) -- ver findPublicPosts.
  /// Accion explicita y separada de crear/editar, a proposito: nada se
  /// publica solo por guardar cambios.
  ///
  /// Gate de revision: solo para contenido tipo Blog (ver
  /// isBlogTypeContent) -- Hub y Enciclopedia publican libremente, sin
  /// pasar por reviewPost. No afecta unpublishPost ni despublica nada
  /// existente: solo intercepta la transicion false -> true.
  async publishPost(id: string) {
    const post = await this.findOnePost(id);
    if (isBlogTypeContent(post.contentType) && post.reviewDecision !== BlogReviewDecision.APROBADO) {
      throw new BadRequestException(
        'Este post debe estar Aprobado en revisión antes de poder publicarse.',
      );
    }
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

  /// `file.filename`/`file.path` ya vienen resueltos por el diskStorage de
  /// multer (ver blog-image.storage.ts) para cuando este metodo corre --
  /// aqui solo se arma la URL publica y se reemplaza la fila. Si el post
  /// ya tenia una imagen subida previamente, se borra el archivo viejo del
  /// disco para no acumular huerfanos.
  ///
  /// OJO: multer ya escribio `file` en disco ANTES de que este metodo
  /// corra (es parte del interceptor, no de la logica de negocio) -- si
  /// `findOnePost` lanza 404 (postId invalido), ese archivo recien escrito
  /// quedaria huerfano si no se borra explicitamente en el catch.
  async uploadImage(postId: string, file: { filename: string }) {
    let post: Awaited<ReturnType<typeof this.findOnePost>>;
    try {
      post = await this.findOnePost(postId);
    } catch (err) {
      this.deleteImageFileIfOwned(blogImagePublicUrl(file.filename));
      throw err;
    }
    this.deleteImageFileIfOwned(post.imageUrl);
    const imageUrl = blogImagePublicUrl(file.filename);
    return this.prisma.blogPost.update({ where: { id: postId }, data: { imageUrl } });
  }

  async removeImage(postId: string) {
    const post = await this.findOnePost(postId);
    this.deleteImageFileIfOwned(post.imageUrl);
    return this.prisma.blogPost.update({ where: { id: postId }, data: { imageUrl: null } });
  }

  /// Solo borra archivos que vivan en nuestra propia carpeta de subidas --
  /// `imageUrl` es un campo de texto libre en el modelo, asi que en teoria
  /// podria apuntar a otra cosa (edicion manual en DB, import futuro,
  /// etc.); jamas intentar unlink() sobre una URL externa.
  private deleteImageFileIfOwned(imageUrl: string | null) {
    if (!imageUrl) return;
    const filename = imageUrl.split('/').pop();
    if (!filename) return;
    const filePath = join(BLOG_IMAGE_UPLOAD_DIR, filename);
    if (filePath.startsWith(BLOG_IMAGE_UPLOAD_DIR) && existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  /// Listado paginado de la API publica -- solo posts publicados a mano
  /// desde el panel (ver publishPost). Sin esto, cualquier post recien
  /// creado o a medio redactar apareceria en WordPress de inmediato.
  ///
  /// Sin `contentType` en el query, se mantiene el comportamiento de
  /// siempre (solo contenido tipo Blog / posts legados con contentType
  /// null) -- asi [diario_blog] en WordPress sigue viendo exactamente lo
  /// mismo que hoy. Hub/Enciclopedia solo aparecen si se piden
  /// explicitamente via `?contentType=HUB`/`?contentType=ENCICLOPEDIA` (o
  /// sus variantes SOUS-HUB), para no colarse por accidente en un listado
  /// que WordPress todavia no sabe renderizar.
  async findPublicPosts(
    query: QueryPublicBlogPostsDto,
  ): Promise<{ data: PublicBlogPost[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.BlogPostWhereInput = {
      published: true,
      ...(query.hub ? { hub: query.hub } : {}),
      ...contentTypeFamilyWhere(query.contentType || 'BLOG'),
    };

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

  private toPublicBlogPost(post: BlogPost & { sections: BlogPostSection[]; faqs: BlogFaq[] }): PublicBlogPost {
    return {
      id: post.id,
      slug: post.slug,
      contentType: post.contentType,
      hub: post.hub,
      subHub: post.subHub,
      title: post.title,
      metaTitle: post.metaTitle,
      metaDescription: post.metaDescription,
      tagPrincipal: post.tagPrincipal,
      tagsSecondary: post.tagsSecondary,
      sections: post.sections.map((s) => ({ order: s.order, heading: s.heading, body: s.body })),
      faqs: post.faqs.map((f) => ({ question: f.question, answer: f.answer })),
      imageUrl: post.imageUrl || DEFAULT_ARTICLE_IMAGE_URL,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
    };
  }
}
