import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../queue/queue.constants';

interface StageStatus {
  queue: string;
  label: string;
  waiting: number;
  active: number;
  delayed: number;
}

export interface PipelineStatus {
  isActive: boolean;
  totalPending: number;
  stages: StageStatus[];
}

const STAGE_LABELS: Record<string, string> = {
  [QUEUE_NAMES.INGEST]: 'Ingesta',
  [QUEUE_NAMES.FILTER]: 'Filtrado',
  [QUEUE_NAMES.SCORE]: 'Puntuación',
  [QUEUE_NAMES.REWRITE]: 'Reescritura',
  [QUEUE_NAMES.GROUND]: 'Verificación de fidelidad',
  [QUEUE_NAMES.COMPLIANCE]: 'Cumplimiento',
};

/// Fuente de verdad para el indicador visual "hay un proceso corriendo /
/// termino" del panel (brief: el usuario debe poder ver, sin refrescar a
/// ciegas, que el pipeline esta trabajando y cuando deja de estarlo).
/// Deliberadamente cuenta jobs de TODAS las etapas (ingest..compliance)
/// en vez de rastrear una sola "corrida" -- cualquier disparo (Correr
/// ahora, Seleccionar mejores ahora, un reintento automatico, Regenerar)
/// debe reflejarse aqui sin que cada uno necesite su propio mecanismo de
/// tracking.
@Injectable()
export class PipelineStatusService {
  constructor(
    @InjectQueue(QUEUE_NAMES.INGEST) private readonly ingestQueue: Queue,
    @InjectQueue(QUEUE_NAMES.FILTER) private readonly filterQueue: Queue,
    @InjectQueue(QUEUE_NAMES.SCORE) private readonly scoreQueue: Queue,
    @InjectQueue(QUEUE_NAMES.REWRITE) private readonly rewriteQueue: Queue,
    @InjectQueue(QUEUE_NAMES.GROUND) private readonly groundQueue: Queue,
    @InjectQueue(QUEUE_NAMES.COMPLIANCE) private readonly complianceQueue: Queue,
  ) {}

  async getStatus(): Promise<PipelineStatus> {
    const queues: [string, Queue][] = [
      [QUEUE_NAMES.INGEST, this.ingestQueue],
      [QUEUE_NAMES.FILTER, this.filterQueue],
      [QUEUE_NAMES.SCORE, this.scoreQueue],
      [QUEUE_NAMES.REWRITE, this.rewriteQueue],
      [QUEUE_NAMES.GROUND, this.groundQueue],
      [QUEUE_NAMES.COMPLIANCE, this.complianceQueue],
    ];

    const stages = await Promise.all(
      queues.map(async ([name, queue]) => {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed');
        return {
          queue: name,
          label: STAGE_LABELS[name],
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
        };
      }),
    );

    const totalPending = stages.reduce((sum, s) => sum + s.waiting + s.active + s.delayed, 0);

    return { isActive: totalPending > 0, totalPending, stages };
  }
}
