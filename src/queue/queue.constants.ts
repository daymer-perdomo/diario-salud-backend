/// Una cola por etapa del pipeline (ver plan de arquitectura, seccion
/// "Confiabilidad de ingesta"). Cada etapa se encola por separado para que
/// la concurrencia y los reintentos se configuren de forma independiente:
/// ingesta es I/O-bound (mas concurrencia posible), las etapas con IA son
/// mas costosas/lentas (menor concurrencia).
export const QUEUE_NAMES = {
  INGEST: 'ingest',
  FILTER: 'filter',
  SCORE: 'score',
  REWRITE: 'rewrite',
  GROUND: 'ground',
  COMPLIANCE: 'compliance',
  PUBLISH: 'publish',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  INGEST_SOURCE: 'ingest-source',
  FILTER_ARTICLE: 'filter-article',
  SCORE_ARTICLE: 'score-article',
  REWRITE_ARTICLE: 'rewrite-article',
  GROUND_ARTICLE: 'ground-article',
  CHECK_COMPLIANCE: 'check-compliance',
  PUBLISH_ARTICLE: 'publish-article',
} as const;
