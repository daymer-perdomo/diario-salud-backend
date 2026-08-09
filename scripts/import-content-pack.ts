/// Import manual (no automatico, no forma parte del seed ni del
/// preDeployCommand de render.yaml) desde un paquete de contenido tipo
/// ENTREGA_TABLAS_SEPARADAS.xlsx (hojas HUBS/BLOGS/ENCICLOPEDIA/TAGS) hacia
/// BlogPost/BlogPostSection/BlogFaq/BlogTag. Idempotente: corre siempre por
/// upsert (globalId / (postId,order) / tag), asi que se puede re-correr sin
/// duplicar filas.
///
/// Distinto de import-blog-master.ts (Excel maestro con headings sin
/// redactar y FAQs sin respuesta): este paquete ya trae el cuerpo completo y
/// las respuestas de las FAQs escritas -- el parseo del cuerpo en secciones
/// H2 y preguntas frecuentes lo hace extract_content_pack.py, este script
/// solo hace los upserts. Mismo motivo que el otro import para usar Python +
/// openpyxl en vez de exceljs (Node) -- ver extract_content_pack.py.
///
/// Todo post se crea con published:false y reviewDecision:PENDIENTE --
/// nunca queda visible en WordPress ni pre-aprobado solo por importarse.
///
/// Uso: npx ts-node scripts/import-content-pack.ts <ruta.xlsx> [--limit N]
/// --limit controla cuantas filas se importan POR HOJA (HUBS/BLOGS/
/// ENCICLOPEDIA), default 10 -- mismo criterio ya usado para el Excel
/// maestro: revisar calidad antes de escalar a las ~800 filas totales del
/// paquete. Los tags (hoja TAGS) tambien respetan --limit.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

function runExtractor(xlsxPath: string, limit: number): Extracted {
  const outPath = path.join(os.tmpdir(), `content-pack-extract-${Date.now()}.json`);
  const scriptPath = path.join(__dirname, 'extract_content_pack.py');
  console.log(`Extrayendo con Python (openpyxl): ${scriptPath}`);
  execFileSync('python3', [scriptPath, xlsxPath, String(limit), outPath], {
    stdio: 'inherit',
  });
  const raw = fs.readFileSync(outPath, 'utf-8');
  fs.unlinkSync(outPath);
  return JSON.parse(raw) as Extracted;
}

function fallbackSlug(globalId: string): string {
  return globalId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: import-content-pack.ts <ruta.xlsx> [--limit N]');
    process.exit(1);
  }
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : 10;

  const extracted = runExtractor(filePath, limit);

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
      const existing = await prisma.blogFaq.findFirst({
        where: { postId: post.id, questionNumber },
      });
      const faqData = { postId: post.id, questionNumber, question: f.question, answer: f.answer };
      if (existing) {
        await prisma.blogFaq.update({ where: { id: existing.id }, data: faqData });
      } else {
        await prisma.blogFaq.create({ data: faqData });
      }
      faqCount++;
    }
  }
  console.log(`BlogPost: ${postCount} filas importadas/actualizadas.`);
  console.log(`BlogPostSection: ${sectionCount} secciones importadas/actualizadas.`);
  console.log(`BlogFaq: ${faqCount} FAQs importadas/actualizadas.`);

  let tagCount = 0;
  for (const t of extracted.tags) {
    await prisma.blogTag.upsert({
      where: { tag: t.tag },
      update: { role: t.role, linkedHubs: t.linkedHubs, examples: t.examples, usageRule: t.usageRule },
      create: { tag: t.tag, role: t.role, linkedHubs: t.linkedHubs, examples: t.examples, usageRule: t.usageRule },
    });
    tagCount++;
  }
  console.log(`BlogTag: ${tagCount} filas importadas/actualizadas.`);

  console.log(
    `\nResumen: ${postCount} posts, ${sectionCount} secciones, ${faqCount} FAQs, ${tagCount} tags importados.`,
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
