import { randomUUID } from 'crypto';

/// Normaliza un titulo a una URL legible: sin acentos, minusculas,
/// separado por guiones. Extraido de la implementacion privada que ya
/// tenia BlogService (unico otro lugar que generaba slugs en este
/// backend) para que Article la reutilice tal cual en vez de duplicarla.
export function slugify(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || randomUUID()
  );
}
