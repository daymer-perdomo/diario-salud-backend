import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  Article,
  ArticleState,
  CheckStatus,
  Prisma,
  RiskLevel,
  ValidationDecision,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService, TransactionClient } from '../audit/audit-log.service';

/// Unico punto de escritura permitido sobre Article.state. Cada metodo
/// representa una transicion valida de la maquina de estados del plan de
/// arquitectura; los CHECK constraints de Postgres (migracion
/// 20260712172200) son el respaldo final si algun bug aqui se equivocara.
/// Cada transicion se escribe en la MISMA transaccion que su AuditLog
/// (invariante 5): nunca puede existir un cambio de estado sin auditoria.
@Injectable()
export class ArticleStateMachineService {
  private readonly logger = new Logger(ArticleStateMachineService.name);

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogService) {}

  private async getCurrent(tx: TransactionClient, articleId: string): Promise<Article> {
    const article = await tx.article.findUnique({ where: { id: articleId } });
    if (!article) throw new BadRequestException(`Article ${articleId} no encontrado`);
    return article;
  }

  private assertState(article: Article, allowed: ArticleState[]) {
    if (!allowed.includes(article.state)) {
      throw new BadRequestException(
        `Transicion invalida: Article ${article.id} esta en ${article.state}, se esperaba uno de [${allowed.join(', ')}]`,
      );
    }
  }

  async markDiscarded(articleId: string, reason: string): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);
      this.assertState(current, [ArticleState.RECOLECTADO]);

      const updated = await tx.article.update({
        where: { id: articleId },
        data: { state: ArticleState.DESCARTADO, isRelevant: false, relevanceReason: reason },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'DISCARDED',
          actorType: 'AI',
          fromState: current.state,
          toState: updated.state,
          payload: { reason },
        },
        tx,
      );
      return updated;
    });
  }

  async markEvaluated(
    articleId: string,
    params: { relevanceScore: number; relevanceReason: string; riskLevel: RiskLevel; riskReason: string },
  ): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);
      this.assertState(current, [ArticleState.RECOLECTADO]);

      const updated = await tx.article.update({
        where: { id: articleId },
        data: {
          state: ArticleState.EVALUADO,
          isRelevant: true,
          relevanceScore: params.relevanceScore,
          relevanceReason: params.relevanceReason,
          riskLevel: params.riskLevel,
          riskReason: params.riskReason,
        },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'SCORED',
          actorType: 'AI',
          fromState: current.state,
          toState: updated.state,
          payload: params,
        },
        tx,
      );
      return updated;
    });
  }

  async markRewritten(
    articleId: string,
    params: { rewrittenTitle: string; rewrittenSummary: string; rewrittenContent: string; rewriteModel: string },
  ): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);
      this.assertState(current, [ArticleState.EVALUADO, ArticleState.GROUNDING_FALLIDO, ArticleState.CUMPLIMIENTO_FALLIDO]);

      const updated = await tx.article.update({
        where: { id: articleId },
        data: {
          state: ArticleState.REESCRITO,
          rewrittenTitle: params.rewrittenTitle,
          rewrittenSummary: params.rewrittenSummary,
          rewrittenContent: params.rewrittenContent,
          rewriteModel: params.rewriteModel,
          rewriteAttempts: { increment: 1 },
          // Un nuevo intento de reescritura invalida cualquier veredicto previo.
          groundingStatus: CheckStatus.PENDIENTE,
          complianceStatus: CheckStatus.PENDIENTE,
        },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'REWRITTEN',
          actorType: 'AI',
          fromState: current.state,
          toState: updated.state,
          payload: { rewriteModel: params.rewriteModel, attempt: updated.rewriteAttempts },
        },
        tx,
      );
      return updated;
    });
  }

  /// Registra el veredicto de fidelidad (anti-invencion). APROBADO no
  /// mueve el `state` -- el articulo sigue en REESCRITO hasta que
  /// tambien pase compliance (ver markComplianceResult). RECHAZADO lo
  /// manda a GROUNDING_FALLIDO, donde GroundingModule decide si
  /// reintenta automaticamente (<=1 vez) o lo deja en cola de triage
  /// humano -- esa politica de reintento vive en GroundingModule, no
  /// aqui; este metodo solo registra el resultado.
  async markGroundingResult(
    articleId: string,
    status: CheckStatus,
    report: Record<string, unknown>,
  ): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);
      this.assertState(current, [ArticleState.REESCRITO]);

      const updated = await tx.article.update({
        where: { id: articleId },
        data: {
          groundingStatus: status,
          groundingReport: report as Prisma.InputJsonValue,
          state: status === CheckStatus.RECHAZADO ? ArticleState.GROUNDING_FALLIDO : current.state,
        },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'GROUNDING_CHECKED',
          actorType: 'AI',
          fromState: current.state,
          toState: updated.state,
          payload: { status },
        },
        tx,
      );
      return updated;
    });
  }

  /// Analogo a markGroundingResult para el chequeo de cumplimiento
  /// normativo. Solo cuando AMBOS (grounding y compliance) estan
  /// APROBADO se permite avanzar a BORRADOR -- lo exige tambien el CHECK
  /// "draft_requires_clean_checks" de Postgres.
  async markComplianceResult(
    articleId: string,
    status: CheckStatus,
    report: Record<string, unknown>,
  ): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);
      this.assertState(current, [ArticleState.REESCRITO]);

      if (status === CheckStatus.APROBADO && current.groundingStatus !== CheckStatus.APROBADO) {
        throw new BadRequestException(
          `Article ${articleId}: no se puede aprobar compliance sin grounding APROBADO (grounding actual: ${current.groundingStatus})`,
        );
      }

      const nextState =
        status === CheckStatus.RECHAZADO
          ? ArticleState.CUMPLIMIENTO_FALLIDO
          : ArticleState.BORRADOR;

      const updated = await tx.article.update({
        where: { id: articleId },
        data: {
          complianceStatus: status,
          complianceReport: report as Prisma.InputJsonValue,
          state: nextState,
        },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'COMPLIANCE_CHECKED',
          actorType: 'AI',
          fromState: current.state,
          toState: updated.state,
          payload: { status },
        },
        tx,
      );
      return updated;
    });
  }

  async submitForValidation(articleId: string): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);
      this.assertState(current, [ArticleState.BORRADOR]);

      const updated = await tx.article.update({
        where: { id: articleId },
        data: { state: ArticleState.EN_VALIDACION },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'SUBMITTED_FOR_VALIDATION',
          actorType: 'SYSTEM',
          fromState: current.state,
          toState: updated.state,
        },
        tx,
      );
      return updated;
    });
  }

  /// Unica forma de que un humano apruebe o rechace un articulo. Si
  /// decision incluye ediciones manuales del texto, se aplican aqui
  /// mismo antes de fijar VALIDADO -- el texto editado por un humano no
  /// vuelve a pasar por grounding (ya lo reviso una persona), pero se
  /// deja registrado en validationNotes que hubo edicion manual.
  async validate(
    articleId: string,
    params: {
      validatorId: string;
      decision: ValidationDecision;
      notes?: string;
      editedTitle?: string;
      editedSummary?: string;
      editedContent?: string;
    },
  ): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);
      this.assertState(current, [ArticleState.EN_VALIDACION]);

      const nextState =
        params.decision === ValidationDecision.RECHAZADO ? ArticleState.RECHAZADO : ArticleState.VALIDADO;

      const updated = await tx.article.update({
        where: { id: articleId },
        data: {
          state: nextState,
          validatorId: params.validatorId,
          validationDecision: params.decision,
          validationNotes: params.notes,
          validatedAt: nextState === ArticleState.VALIDADO ? new Date() : null,
          rewrittenTitle: params.editedTitle ?? current.rewrittenTitle,
          rewrittenSummary: params.editedSummary ?? current.rewrittenSummary,
          rewrittenContent: params.editedContent ?? current.rewrittenContent,
        },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'HUMAN_VALIDATION',
          actorType: 'HUMAN',
          actorId: params.validatorId,
          fromState: current.state,
          toState: updated.state,
          payload: { decision: params.decision, notes: params.notes, edited: Boolean(params.editedContent) },
        },
        tx,
      );
      return updated;
    });
  }

  /// Solo guarda el wordpressPostId del draft creado -- el estado se
  /// mantiene en VALIDADO. La publicacion real (que sí cambia state) es
  /// un paso EXPLICITO Y SEPARADO via publish(), nunca automatico.
  async recordWordpressDraft(articleId: string, wordpressPostId: number, tagIds: number[]): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);
      this.assertState(current, [ArticleState.VALIDADO]);

      const updated = await tx.article.update({
        where: { id: articleId },
        data: { wordpressPostId, wordpressTagIds: tagIds as unknown as Prisma.InputJsonValue },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'WORDPRESS_DRAFT_CREATED',
          actorType: 'SYSTEM',
          fromState: current.state,
          toState: updated.state,
          payload: { wordpressPostId },
        },
        tx,
      );
      return updated;
    });
  }

  /// Unico metodo autorizado para fijar PUBLICADO. Revalida en codigo la
  /// misma condicion que exige el CHECK "publish_requires_validation" de
  /// Postgres -- redundante a proposito (defensa en profundidad).
  async publish(articleId: string, actorId: string): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);
      this.assertState(current, [ArticleState.VALIDADO]);

      if (!current.validatorId || !current.validatedAt || !current.wordpressPostId) {
        throw new BadRequestException(
          `Article ${articleId}: falta validatorId/validatedAt/wordpressPostId -- no se puede publicar`,
        );
      }

      const updated = await tx.article.update({
        where: { id: articleId },
        data: { state: ArticleState.PUBLICADO, publishedAt: new Date(), publishedByUserId: actorId },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'PUBLISHED',
          actorType: 'HUMAN',
          actorId,
          fromState: current.state,
          toState: updated.state,
          payload: { wordpressPostId: current.wordpressPostId },
        },
        tx,
      );
      return updated;
    });
  }

  async markError(articleId: string, stage: string, message: string): Promise<Article> {
    return this.prisma.$transaction(async (tx) => {
      const current = await this.getCurrent(tx, articleId);

      const updated = await tx.article.update({
        where: { id: articleId },
        data: { state: ArticleState.ERROR, errorStage: stage, lastErrorMessage: message },
      });
      await this.audit.record(
        {
          entityType: 'Article',
          entityId: articleId,
          action: 'ERROR',
          actorType: 'SYSTEM',
          fromState: current.state,
          toState: updated.state,
          payload: { stage, message },
        },
        tx,
      );
      return updated;
    });
  }
}
