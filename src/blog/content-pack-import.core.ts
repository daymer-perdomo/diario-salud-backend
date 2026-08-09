import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

interface ExtractedSection {
  heading: string;
  body: string | null;
}

interface ExtractedFaq {
  question: string;
  answer: string | null;
}

interface ExtractedPost {
  globalId: string;
  sourceContentId: string | null;
  sourceFile: string | null;
  contentType: string;
  hub: string;
  subHub: string | null;
  title: string;
  slug: string | null;
  tagPrincipal: string | null;
  tagsSecondary: string[];
  intro: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  internalLinksNotes: string | null;
  sourcesConsultadas: string | null;
  regulatoryLevel: string | null;
  productPolicy: string | null;
  sections: ExtractedSection[];
  faqs: ExtractedFaq[];
}

interface ExtractedTag {
  tag: string;
  role: string | null;
  linkedHubs: string | null;
  examples: string | null;
  usageRule: string | null;
}

interface Extracted {
  posts: ExtractedPost[];
  tags: ExtractedTag[];
}

export interface ContentPackImportSummary {
  posts: number;
  sections: number;
  faqs: number;
  tags: number;
}

function fallbackSlug(globalId: string): string {
  return globalId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function runExtractor(xlsxPath: string, limit: number): Extracted {
  const outPath = path.join(os.tmpdir(), `content-pack-extract-${Date.now()}.json`);
  // process.cwd(), no __dirname: cuando Nest empaqueta este archivo con
  // webpack (nest start/build), __dirname deja de apuntar a src/blog y
  // resuelve distinto -- mismo motivo por el que blog-image.storage.ts usa
  // process.cwd() en vez de __dirname. cwd es la raiz del repo tanto al
  // correr el server (npm run start:dev / dist/main.js) como el script
  // CLI (npx ts-node scripts/...), siempre invocados desde ahi.
  const scriptPath = path.join(process.cwd(), 'scripts', 'extract_content_pack.py');
  execFileSync('python3', [scriptPath, xlsxPath, String(limit), outPath], { stdio: 'inherit' });
  const raw = fs.readFileSync(outPath, 'utf-8');
  fs.unlinkSync(outPath);
  return JSON.parse(raw) as Extracted;
}

/// Logica compartida de importacion de un paquete de contenido tipo
/// ENTREGA_TABLAS_SEPARADAS.xlsx (hojas HUBS/BLOGS/ENCICLOPEDIA/TAGS) hacia
/// BlogPost/BlogPostSection/BlogFaq/BlogTag -- funcion plana (no
/// @Injectable) para que la puedan llamar tanto ContentPackImportService
/// (con PrismaService, inyectado en el modulo de Nest) como
/// scripts/import-content-pack.ts (con un PrismaClient standalone, sin
/// arrancar el contexto completo de Nest -- eso ultimo se probo y resulto
/// muy pesado/lento para un script de linea de comandos, ver historial).
/// Idempotente: corre siempre por upsert (globalId / (postId,order) / tag),
/// asi que se puede re-correr sin duplicar filas.
///
/// La lectura real del .xlsx la hace extract_content_pack.py (Python +
/// openpyxl) -- exceljs (Node) no logra parsear este estilo de archivo, ver
/// ese script para el porque. Requiere python3 + openpyxl en la maquina (o
/// en el contenedor de Render).
///
/// Todo post se crea con published:false y reviewDecision:PENDIENTE --
/// nunca queda visible en WordPress ni pre-aprobado solo por importarse.
///
/// `limit` = filas maximas por hoja (HUBS/BLOGS/ENCICLOPEDIA) y para TAGS --
/// mismo criterio que el importador del Excel maestro: revisar calidad
/// antes de escalar a las ~800 filas totales del paquete.
export async function runContentPackImport(
  prisma: PrismaClient,
  xlsxPath: string,
  limit: number,
): Promise<ContentPackImportSummary> {
  const extracted = runExtractor(xlsxPath, limit);

  let postCount = 0;
  let sectionCount = 0;
  let faqCount = 0;

  for (const p of extracted.posts) {
    const slug = p.slug || fallbackSlug(p.globalId);
    const data = {
      sourceContentId: p.sourceContentId,
      sourceFile: p.sourceFile,
      contentType: p.contentType,
      hub: p.hub,
      subHub: p.subHub,
      title: p.title,
      slug,
      tagPrincipal: p.tagPrincipal,
      tagsSecondary: p.tagsSecondary,
      intro: p.intro,
      metaTitle: p.metaTitle,
      metaDescription: p.metaDescription,
      internalLinksNotes: p.internalLinksNotes,
      sourcesConsultadas: p.sourcesConsultadas,
      regulatoryLevel: p.regulatoryLevel,
      productPolicy: p.productPolicy,
    };
    const post = await prisma.blogPost.upsert({
      where: { globalId: p.globalId },
      update: data,
      create: { globalId: p.globalId, ...data },
    });
    postCount++;

    for (let i = 0; i < p.sections.length; i++) {
      const s = p.sections[i];
      await prisma.blogPostSection.upsert({
        where: { postId_order: { postId: post.id, order: i + 1 } },
        update: { heading: s.heading, body: s.body },
        create: { postId: post.id, order: i + 1, heading: s.heading, body: s.body },
      });
      sectionCount++;
    }

    for (let i = 0; i < p.faqs.length; i++) {
      const f = p.faqs[i];
      const questionNumber = i + 1;
      const existing = await prisma.blogFaq.findFirst({ where: { postId: post.id, questionNumber } });
      const faqData = { postId: post.id, questionNumber, question: f.question, answer: f.answer };
      if (existing) {
        await prisma.blogFaq.update({ where: { id: existing.id }, data: faqData });
      } else {
        await prisma.blogFaq.create({ data: faqData });
      }
      faqCount++;
    }
  }

  let tagCount = 0;
  for (const t of extracted.tags) {
    await prisma.blogTag.upsert({
      where: { tag: t.tag },
      update: { role: t.role, linkedHubs: t.linkedHubs, examples: t.examples, usageRule: t.usageRule },
      create: { tag: t.tag, role: t.role, linkedHubs: t.linkedHubs, examples: t.examples, usageRule: t.usageRule },
    });
    tagCount++;
  }

  return { posts: postCount, sections: sectionCount, faqs: faqCount, tags: tagCount };
}
