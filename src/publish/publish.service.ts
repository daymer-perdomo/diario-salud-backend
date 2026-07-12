import { BadRequestException, Injectable } from '@nestjs/common';
import { ArticleState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ArticleStateMachineService } from '../articles/article-state-machine.service';
import { WordpressClientService } from './wordpress-client.service';

@Injectable()
export class PublishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: ArticleStateMachineService,
    private readonly wordpress: WordpressClientService,
  ) {}

  /// Articulos validados por un humano, listos para pasar a WordPress
  /// (borrador si aun no tienen wordpressPostId, o publicacion si ya lo tienen).
  getPublishQueue() {
    return this.prisma.article.findMany({
      where: { state: ArticleState.VALIDADO },
      orderBy: { validatedAt: 'asc' },
      include: { source: true },
    });
  }

  /// Paso 1 de 2, condicionado a VALIDADO. Crea el post en WordPress como
  /// `draft` -- NO lo publica. El estado del articulo permanece VALIDADO;
  /// solo se agrega wordpressPostId.
  async createDraft(articleId: string) {
    const article = await this.prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      include: { source: true },
    });

    if (article.state !== ArticleState.VALIDADO) {
      throw new BadRequestException(`Article ${articleId} esta en ${article.state}, se esperaba VALIDADO`);
    }
    if (article.wordpressPostId) {
      throw new BadRequestException(`Article ${articleId} ya tiene un draft de WordPress (post ${article.wordpressPostId})`);
    }

    const tagNames = [
      `source-${article.source.institutionCode.toLowerCase()}`,
      article.riskLevel ? `riesgo-${article.riskLevel.toLowerCase()}` : null,
    ].filter((t): t is string => Boolean(t));

    const tagIds = await this.wordpress.resolveOrCreateTagIds(tagNames);

    // Si la fuente no trajo imagen (imageUrl=null), simplemente no se
    // sube nada -- nunca se genera ni se asume una imagen de relleno.
    const featuredMediaId = article.imageUrl
      ? await this.wordpress.uploadMediaFromUrl(article.imageUrl)
      : null;

    const post = await this.wordpress.createDraftPost({
      title: article.rewrittenTitle ?? article.originalTitle,
      content: this.buildPostBody(article),
      excerpt: article.rewrittenSummary ?? '',
      tagIds,
      featuredMediaId,
    });

    return this.stateMachine.recordWordpressDraft(articleId, post.id, tagIds);
  }

  /// Paso 2 de 2: PATCH explicito a status=publish sobre un post que ya
  /// existe como draft. Es la UNICA via para que un articulo llegue a
  /// PUBLICADO -- ver ArticleStateMachineService.publish, que revalida
  /// las mismas condiciones que el CHECK de Postgres.
  async publish(articleId: string, actorId: string) {
    const article = await this.prisma.article.findUniqueOrThrow({ where: { id: articleId } });

    if (article.state !== ArticleState.VALIDADO) {
      throw new BadRequestException(`Article ${articleId} esta en ${article.state}, se esperaba VALIDADO`);
    }
    if (!article.wordpressPostId) {
      throw new BadRequestException(`Article ${articleId} no tiene draft de WordPress -- llamar createDraft primero`);
    }

    await this.wordpress.publishPost(article.wordpressPostId);
    return this.stateMachine.publish(articleId, actorId);
  }

  private buildPostBody(article: { rewrittenContent: string | null; sourceInstitution: string; sourceUrl: string; sourcePublishedAt: Date }): string {
    const disclaimer =
      'Este contenido tiene fines exclusivamente informativos y no sustituye la orientacion de un profesional de la salud.';
    const sourceBlock =
      `<p><em>Fuente: ${article.sourceInstitution}, ` +
      `${article.sourcePublishedAt.toISOString().slice(0, 10)}. ` +
      `<a href="${article.sourceUrl}" target="_blank" rel="noopener">Consultar la fuente oficial</a>.</em></p>`;

    return [
      `<p>${(article.rewrittenContent ?? '').replace(/\n/g, '</p><p>')}</p>`,
      sourceBlock,
      `<p><small>${disclaimer}</small></p>`,
    ].join('\n');
  }
}
