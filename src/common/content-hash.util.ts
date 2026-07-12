import { createHash } from 'crypto';

/// Hash determinista sobre titulo+texto normalizados, usado para
/// deduplicar candidatos antes de crear una fila Article
/// (@@unique([sourceId, originalContentHash]) en el schema de Prisma).
export function computeContentHash(title: string, text: string): string {
  const normalized = `${title}\n${text}`.trim().replace(/\s+/g, ' ').toLowerCase();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
