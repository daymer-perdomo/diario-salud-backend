import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueryBlogPostsDto } from './dto/query-blog-posts.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { UpdateBlogSectionDto } from './dto/update-blog-section.dto';
import { UpdateBlogFaqDto } from './dto/update-blog-faq.dto';

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
}
