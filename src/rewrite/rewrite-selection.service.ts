import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ArticlesService } from '../articles/articles.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

/// Unico lugar que decide cuales articulos EVALUADO avanzan a las etapas
/// caras del pipeline (rewrite/grounding/compliance, todas con llamadas
/// a LLM). ScoringProcessor deja todo articulo relevante en EVALUADO sin
/// encolarlo -- solo deja pasar los mejores DAILY_REWRITE_LIMIT (default 5)
/// QUE ADEMAS superen MIN_RELEVANCE_SCORE_FOR_REWRITE (default 0.5) -- un
/// piso de calidad duro, no solo un tope de cantidad. Si nada alcanza el
/// piso, no se selecciona nada: nunca se "rellena la cuota" con contenido
/// de baja calidad solo para completar 5. Lo que no entra se queda
/// visible en EVALUADO (no se pierde ni se descarta).
///
/// Decision 2026-07-16 (revertida el mismo dia, pedido explicito del
/// usuario): el freno manual causaba que articulos ya evaluados
/// quedaran invisibles en el panel (ni en Cola de validacion ni en
/// Triage) hasta que alguien presionara "Seleccionar mejores ahora" a
/// mano. Se repone un cron diario -- los topes que motivaron el freno
/// original (DAILY_REWRITE_LIMIT, MIN_RELEVANCE_SCORE_FOR_REWRITE,
/// MAX_LLM_BUDGET_USD) siguen vigentes y siguen acotando el gasto, asi
/// que el riesgo del incidente del 12/07 (encolar todo sin tope) no
/// vuelve. El boton "Seleccionar mejores ahora" se mantiene para
/// disparar una corrida fuera de horario.
///
/// jobId deterministico (rewrite-<articleId>) para que una segunda
/// corrida de seleccion antes de que Rewrite procese la anterior no
/// duplique el job -- mismo patron que IngestionDispatcher.enqueueSource.
@Injectable()
export class RewriteSelectionService {
  private readonly logger = new Logger(RewriteSelectionService.name);

  constructor(
    private readonly articlesService: ArticlesService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.REWRITE) private readonly rewriteQueue: Queue,
  ) {}

  @Cron('0 6 * * *')
  async runScheduledSelection(): Promise<void> {
    await this.runSelection();
  }

  async runSelection(): Promise<{ selected: number; limit: number; minScore: number }> {
    const limit = this.config.get<number>('DAILY_REWRITE_LIMIT') ?? 5;
    const minScore = this.config.get<number>('MIN_RELEVANCE_SCORE_FOR_REWRITE') ?? 0.5;
    const candidates = await this.articlesService.findTopEvaluatedByRelevance(limit, minScore);

    for (const article of candidates) {
      await this.rewriteQueue.add(
        JOB_NAMES.REWRITE_ARTICLE,
        { articleId: article.id },
        {
          jobId: `rewrite-${article.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
        },
      );
    }

    this.logger.log(
      `Seleccion diaria: ${candidates.length}/${limit} articulo(s) encolado(s) a rewrite ` +
        `(piso de calidad=${minScore}, scores: ${candidates.map((a) => a.relevanceScore?.toFixed(2)).join(', ') || 'ninguno'})`,
    );
    return { selected: candidates.length, limit, minScore };
  }
}
