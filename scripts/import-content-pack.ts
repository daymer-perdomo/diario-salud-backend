/// Import manual (no automatico, no forma parte del seed ni del
/// preDeployCommand de render.yaml) desde un paquete de contenido tipo
/// ENTREGA_TABLAS_SEPARADAS.xlsx (hojas HUBS/BLOGS/ENCICLOPEDIA/TAGS) hacia
/// BlogPost/BlogPostSection/BlogFaq/BlogTag. Wrapper delgado de linea de
/// comandos sobre runContentPackImport (src/blog/content-pack-import.core.ts)
/// -- la logica real vive ahi, compartida con POST /blog/import (subida
/// desde el panel). Usa un PrismaClient standalone en vez de arrancar el
/// contexto completo de Nest (se probo con NestFactory.
/// createApplicationContext y resulto demasiado pesado/lento para un
/// script de terminal).
///
/// Uso: npx ts-node scripts/import-content-pack.ts <ruta.xlsx> [--limit N]
/// --limit controla cuantas filas se importan POR HOJA (HUBS/BLOGS/
/// ENCICLOPEDIA/TAGS), default 10 -- mismo criterio ya usado para el Excel
/// maestro: revisar calidad antes de escalar a las ~800 filas totales del
/// paquete.
import { PrismaClient } from '@prisma/client';
import { runContentPackImport } from '../src/blog/content-pack-import.core';

const prisma = new PrismaClient();

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: import-content-pack.ts <ruta.xlsx> [--limit N]');
    process.exit(1);
  }
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : 10;

  const summary = await runContentPackImport(prisma, filePath, limit);
  console.log(`BlogPost: ${summary.posts} filas importadas/actualizadas.`);
  console.log(`BlogPostSection: ${summary.sections} secciones importadas/actualizadas.`);
  console.log(`BlogFaq: ${summary.faqs} FAQs importadas/actualizadas.`);
  console.log(`BlogTag: ${summary.tags} filas importadas/actualizadas.`);
  console.log(
    `\nResumen: ${summary.posts} posts, ${summary.sections} secciones, ${summary.faqs} FAQs, ${summary.tags} tags importados.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
