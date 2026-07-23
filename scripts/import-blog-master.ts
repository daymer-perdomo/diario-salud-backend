/// Import manual (no automatico, no forma parte del seed ni del
/// preDeployCommand de render.yaml) desde MASTER_GLOBAL_BLOG_ECOFARMA.xlsx
/// hacia BlogPost/BlogPostSection/BlogFaq/BlogTag. Idempotente: corre
/// siempre por upsert (globalId / (postId,order) / tag), asi que se puede
/// re-correr sin duplicar filas.
///
/// La lectura real del .xlsx la hace extract_blog_master.py (Python +
/// openpyxl) -- exceljs (Node) no logra parsear este archivo especifico
/// (falla en workbook.xml al cargar). Este script invoca el extractor,
/// lee el JSON intermedio que produce, y hace los upserts en Postgres via
/// Prisma. Requiere python3 + openpyxl instalados en la maquina.
///
/// Uso: npx ts-node scripts/import-blog-master.ts <ruta.xlsx> [--limit N]
/// --limit controla cuantas filas de BLOG_MASTER se importan (default 10,
/// pedido explicito del usuario: revisar calidad antes de escalar a las
/// 444). Los tags (hoja TAGS_BLOG) se importan siempre completos (242
/// filas) sin importar --limit, porque son catalogo de referencia barato.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ExtractedPost {
  globalId: string;
  sourceContentId: string | null;
  hub: string;
  subHub: string | null;
  title: string;
  slug: string;
  headings: string[];
  cluster: string | null;
  tagPrincipal: string | null;
  tagsSecondary: string[];
  seoPriority: string | null;
  regulatoryLevel: string | null;
  intention: string | null;
  productPolicy: string | null;
  validationRequired: string | null;
  aiGenerationRule: string | null;
  notes: string | null;
  sourceFile: string | null;
  sourceRow: number | null;
}

interface ExtractedFaq {
  globalId: string;
  faqBlockId: string | null;
  questionNumber: number | null;
  question: string;
  sourceQuestion: string | null;
  sourceReferences: string | null;
  regulatoryLevel: string | null;
  productPolicy: string | null;
  validationRequired: string | null;
  notes: string | null;
  sourceFile: string | null;
  sourceRow: number | null;
}

interface ExtractedTag {
  tag: string;
  role: string | null;
  linkedHubs: string | null;
  linkedSubHubs: string | null;
  contentCount: number | null;
  examples: string | null;
  usageRule: string | null;
}

interface Extracted {
  posts: ExtractedPost[];
  faqs: ExtractedFaq[];
  tags: ExtractedTag[];
}

function runExtractor(xlsxPath: string, limit: number): Extracted {
  const outPath = path.join(os.tmpdir(), `blog-master-extract-${Date.now()}.json`);
  const scriptPath = path.join(__dirname, 'extract_blog_master.py');
  console.log(`Extrayendo con Python (openpyxl): ${scriptPath}`);
  execFileSync('python3', [scriptPath, xlsxPath, String(limit), outPath], {
    stdio: 'inherit',
  });
  const raw = fs.readFileSync(outPath, 'utf-8');
  fs.unlinkSync(outPath);
  return JSON.parse(raw) as Extracted;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: import-blog-master.ts <ruta.xlsx> [--limit N]');
    process.exit(1);
  }
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : 10;

  const extracted = runExtractor(filePath, limit);

  let postCount = 0;
  let sectionCount = 0;
  const postIdByGlobalId = new Map<string, string>();

  for (const p of extracted.posts) {
    const post = await prisma.blogPost.upsert({
      where: { globalId: p.globalId },
      update: {
        sourceContentId: p.sourceContentId,
        hub: p.hub,
        subHub: p.subHub,
        title: p.title,
        slug: p.slug,
        cluster: p.cluster,
        tagPrincipal: p.tagPrincipal,
        tagsSecondary: p.tagsSecondary,
        seoPriority: p.seoPriority,
        regulatoryLevel: p.regulatoryLevel,
        intention: p.intention,
        productPolicy: p.productPolicy,
        validationRequired: p.validationRequired,
        aiGenerationRule: p.aiGenerationRule,
        notes: p.notes,
        sourceFile: p.sourceFile,
        sourceRow: p.sourceRow,
      },
      create: {
        globalId: p.globalId,
        sourceContentId: p.sourceContentId,
        hub: p.hub,
        subHub: p.subHub,
        title: p.title,
        slug: p.slug,
        cluster: p.cluster,
        tagPrincipal: p.tagPrincipal,
        tagsSecondary: p.tagsSecondary,
        seoPriority: p.seoPriority,
        regulatoryLevel: p.regulatoryLevel,
        intention: p.intention,
        productPolicy: p.productPolicy,
        validationRequired: p.validationRequired,
        aiGenerationRule: p.aiGenerationRule,
        notes: p.notes,
        sourceFile: p.sourceFile,
        sourceRow: p.sourceRow,
      },
    });
    postCount++;
    postIdByGlobalId.set(p.globalId, post.id);

    for (let i = 0; i < p.headings.length; i++) {
      await prisma.blogPostSection.upsert({
        where: { postId_order: { postId: post.id, order: i + 1 } },
        update: { heading: p.headings[i] },
        create: { postId: post.id, order: i + 1, heading: p.headings[i] },
      });
      sectionCount++;
    }
  }
  console.log(`BlogPost: ${postCount} filas importadas/actualizadas.`);
  console.log(`BlogPostSection: ${sectionCount} H2 importados/actualizados.`);

  let faqCount = 0;
  for (const f of extracted.faqs) {
    const postId = postIdByGlobalId.get(f.globalId);
    if (!postId) continue;
    const existing = await prisma.blogFaq.findFirst({
      where: { postId, faqBlockId: f.faqBlockId, questionNumber: f.questionNumber },
    });
    const data = {
      postId,
      faqBlockId: f.faqBlockId,
      questionNumber: f.questionNumber,
      question: f.question,
      sourceQuestion: f.sourceQuestion,
      sourceReferences: f.sourceReferences,
      regulatoryLevel: f.regulatoryLevel,
      productPolicy: f.productPolicy,
      validationRequired: f.validationRequired,
      notes: f.notes,
      sourceFile: f.sourceFile,
      sourceRow: f.sourceRow,
    };
    if (existing) {
      await prisma.blogFaq.update({ where: { id: existing.id }, data });
    } else {
      await prisma.blogFaq.create({ data });
    }
    faqCount++;
  }
  console.log(`BlogFaq: ${faqCount} filas importadas/actualizadas.`);

  let tagCount = 0;
  for (const t of extracted.tags) {
    await prisma.blogTag.upsert({
      where: { tag: t.tag },
      update: {
        role: t.role,
        linkedHubs: t.linkedHubs,
        linkedSubHubs: t.linkedSubHubs,
        contentCount: t.contentCount,
        examples: t.examples,
        usageRule: t.usageRule,
      },
      create: {
        tag: t.tag,
        role: t.role,
        linkedHubs: t.linkedHubs,
        linkedSubHubs: t.linkedSubHubs,
        contentCount: t.contentCount,
        examples: t.examples,
        usageRule: t.usageRule,
      },
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
