import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Article, ArticleState, Prisma, Source } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { RawCandidate } from '../sources/interfaces/raw-candidate.interface';
import { QueryApprovedArticlesDto } from './dto/query-approved-articles.dto';
import { detectLanguage } from '../common/language-detection.util';
import { DEFAULT_ARTICLE_IMAGE_URL } from '../common/default-article-image.util';

/// Estados que puede tener un articulo aprobado por un revisor humano:
/// VALIDADO (aprobado, aun no expuesto en la API publica) o PUBLICADO
/// (aprobado y ya expuesto). RECHAZADO y todo lo demas nunca entra aqui.
const APPROVED_STATES: ArticleState[] = [ArticleState.VALIDADO, ArticleState.PUBLICADO];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// Meta description para WordPress (ver wp_head en el snippet del
/// shortcode) -- se deriva SIEMPRE de rewrittenSummary en caliente, nunca
/// se guarda en la base: asi nunca queda desactualizada si el resumen se
/// edita despues. Corta en el ultimo espacio antes del limite para no
/// partir una palabra a la mitad.
const META_DESCRIPTION_MAX_LENGTH = 155;

function truncateForMetaDescription(summary: string | null): string | null {
  if (!summary) return null;
  if (summary.length <= META_DESCRIPTION_MAX_LENGTH) return summary;
  const cut = summary.slice(0, META_DESCRIPTION_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

/// Forma de salida de la API publica -- deliberadamente mas angosta que el
/// modelo Prisma: nunca expone originalContent, reportes de grounding/
/// compliance, validatorId ni notas editoriales internas.
export interface PublicArticle {
  id: string;
  /// URL legible para armar el link de detalle en WordPress -- null en
  /// articulos publicados antes de 2026-08-09 (no se les hizo backfill a
  /// proposito, ver docs/integracion-wordpress-diario-salud.md). El
  /// consumidor debe usar slug si existe, si no caer a id.
  slug: string | null;
  title: string;
  summary: string | null;
  /// Version corta de `summary` (~155 caracteres) para <meta
  /// name="description">. Nunca se guarda -- se deriva del resumen
  /// vigente en cada respuesta.
  metaDescription: string | null;
  content: string;
  keyPoints: string[];
  whyItMatters: string | null;
  imageUrl: string | null;
  riskLevel: string | null;
  contentType: string | null;
  state: ArticleState;
  source: { institutionCode: string; name: string; url: string; publishedAt: Date };
  validatedAt: Date | null;
  publishedAt: Date | null;
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

  /// Usado por RewriteSelectionService: candidatos EVALUADO (ya puntuados
  /// por IA, aun no encolados a rewrite), mejor relevanceScore primero.
  /// Es el unico lugar que decide "los mejores N" -- Scoring ya no
  /// encola automaticamente (ver comentario en ScoringProcessor).
  /// minScore es un piso duro: un articulo por debajo no se selecciona
  /// aunque sobren cupos en `limit` -- no se "rellena la cuota" con
  /// contenido de baja calidad.
  findTopEvaluatedByRelevance(limit: number, minScore: number) {
    return this.prisma.article.findMany({
      where: { state: ArticleState.EVALUADO, relevanceScore: { gte: minScore } },
      orderBy: { relevanceScore: 'desc' },
      take: limit,
    });
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
          language: detectLanguage(`${candidate.title} ${candidate.rawText}`),
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
  ///
  /// Acepta id (uuid, todos los links viejos de WordPress siguen
  /// funcionando) o slug (links nuevos, mas legibles -- ver
  /// ArticleStateMachineService.generateUniqueSlug). Un solo endpoint
  /// resuelve ambos, sin rutas nuevas.
  async findApprovedById(idOrSlug: string): Promise<PublicArticle> {
    const where = UUID_REGEX.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug };
    const article = await this.prisma.article.findUnique({ where, include: { source: true } });
    if (!article || !APPROVED_STATES.includes(article.state)) {
      throw new NotFoundException(`Articulo ${idOrSlug} no encontrado`);
    }
    return this.toPublicArticle(article);
  }

  private toPublicArticle(article: Article & { source: Source }): PublicArticle {
    return {
      id: article.id,
      slug: article.slug,
      title: article.rewrittenTitle ?? article.originalTitle,
      summary: article.rewrittenSummary,
      metaDescription: truncateForMetaDescription(article.rewrittenSummary),
      content: article.rewrittenContent ?? '',
      keyPoints: article.rewrittenKeyPoints,
      whyItMatters: article.rewrittenWhyItMatters,
      imageUrl: article.imageUrl ?? DEFAULT_ARTICLE_IMAGE_URL,
      riskLevel: article.riskLevel,
      contentType: article.contentType,
      state: article.state,
      source: {
        institutionCode: article.source.institutionCode,
        name: article.sourceInstitution,
        url: article.sourceUrl,
        publishedAt: article.sourcePublishedAt,
      },
      validatedAt: article.validatedAt,
      publishedAt: article.publishedAt,
    };
  }
}
