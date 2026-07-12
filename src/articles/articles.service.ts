import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Article, ArticleState, Prisma, Source } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { RawCandidate } from '../sources/interfaces/raw-candidate.interface';
import { QueryApprovedArticlesDto } from './dto/query-approved-articles.dto';

/// Estados que puede tener un articulo aprobado por un revisor humano:
/// VALIDADO (aprobado, aun no publicado en WordPress) o PUBLICADO
/// (aprobado y ya publicado). RECHAZADO y todo lo demas nunca entra aqui.
const APPROVED_STATES: ArticleState[] = [ArticleState.VALIDADO, ArticleState.PUBLICADO];

/// Forma de salida de la API publica -- deliberadamente mas angosta que el
/// modelo Prisma: nunca expone originalContent, reportes de grounding/
/// compliance, validatorId ni notas editoriales internas.
export interface PublicArticle {
  id: string;
  title: string;
  summary: string | null;
  content: string;
  imageUrl: string | null;
  riskLevel: string | null;
  state: ArticleState;
  source: { institutionCode: string; name: string; url: string; publishedAt: Date };
  validatedAt: Date | null;
  publishedAt: Date | null;
  wordpressPostId: number | null;
}

@Injectable()
export class ArticlesService {
  private readonly logger = new Logger(ArticlesService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  async findById(id: string): Promise<Article> {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) throw new NotFoundException(`Article ${id} no encontrado`);
    return article;
  }

  findByState(state: ArticleState) {
    return this.prisma.article.findMany({ where: { state }, orderBy: { createdAt: 'asc' } });
  }

  /// Crea la fila RECOLECTADO con toda la procedencia obligatoria. Si ya
  /// existe una fila con el mismo (sourceId, originalContentHash) --
  /// P2002 del @@unique de Prisma -- se trata como duplicado esperado,
  /// no como un error: nunca se sobreescribe ni se genera una segunda
  /// version, se devuelve null y quien llama lo cuenta como
  /// DUPLICATE_SKIPPED (ver IngestionModule).
  async createFromCandidate(
    sourceId: string,
    sourceInstitution: string,
    candidate: RawCandidate,
  ): Promise<Article | null> {
    try {
      const article = await this.prisma.article.create({
        data: {
          sourceId,
          externalId: candidate.externalId,
          sourceUrl: candidate.url,
          sourceInstitution,
          sourcePublishedAt: candidate.publishedAt,
          originalTitle: candidate.title,
          originalExcerpt: candidate.excerpt,
          originalContent: candidate.rawText,
          originalContentHash: candidate.contentHash,
          imageUrl: candidate.imageUrl,
          state: ArticleState.RECOLECTADO,
        },
      });

      await this.audit.record({
        entityType: 'Article',
        entityId: article.id,
        action: 'INGESTED',
        actorType: 'SYSTEM',
        toState: ArticleState.RECOLECTADO,
        payload: { sourceUrl: candidate.url },
      });

      return article;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.debug(`Duplicado omitido: ${candidate.url}`);
        return null;
      }
      throw err;
    }
  }

  /// Listado paginado de la API publica -- solo articulos aprobados por un
  /// revisor humano (ver APPROVED_STATES), nunca borradores ni estados
  /// internos del pipeline.
  async findApproved(
    query: QueryApprovedArticlesDto,
  ): Promise<{ data: PublicArticle[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ArticleWhereInput = {
      state: query.state ? query.state : { in: APPROVED_STATES },
      ...(query.sourceId ? { sourceId: query.sourceId } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.article.findMany({
        where,
        include: { source: true },
        orderBy: { validatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.article.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toPublicArticle(row)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /// Detalle publico de un articulo. Devuelve 404 tanto si no existe como
  /// si existe pero no esta aprobado -- para no revelar que un articulo en
  /// estado interno (BORRADOR, ERROR, etc) esta siendo procesado.
  async findApprovedById(id: string): Promise<PublicArticle> {
    const article = await this.prisma.article.findUnique({ where: { id }, include: { source: true } });
    if (!article || !APPROVED_STATES.includes(article.state)) {
      throw new NotFoundException(`Articulo ${id} no encontrado`);
    }
    return this.toPublicArticle(article);
  }

  private toPublicArticle(article: Article & { source: Source }): PublicArticle {
    return {
      id: article.id,
      title: article.rewrittenTitle ?? article.originalTitle,
      summary: article.rewrittenSummary,
      content: article.rewrittenContent ?? '',
      imageUrl: article.imageUrl,
      riskLevel: article.riskLevel,
      state: article.state,
      source: {
        institutionCode: article.source.institutionCode,
        name: article.sourceInstitution,
        url: article.sourceUrl,
        publishedAt: article.sourcePublishedAt,
      },
      validatedAt: article.validatedAt,
      publishedAt: article.publishedAt,
      wordpressPostId: article.wordpressPostId,
    };
  }
}
