import { Job } from 'bullmq';

/// El evento 'failed' de un Worker de BullMQ se dispara en CADA intento
/// fallido, no solo en el ultimo -- sin este chequeo, un job que aun
/// tiene reintentos pendientes marcaria el Article como ERROR de forma
/// prematura. Solo cuando ya no quedan reintentos se considera un fallo
/// terminal (y por lo tanto se le debe dar visibilidad via
/// ArticleStateMachineService.markError, para que no quede "atascado"
/// en su estado anterior sin que ningun humano lo note).
export function isTerminalFailure(job: Job | undefined): boolean {
  if (!job) return true;
  const maxAttempts = job.opts?.attempts ?? 1;
  return job.attemptsMade >= maxAttempts;
}
