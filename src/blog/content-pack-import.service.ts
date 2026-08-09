import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContentPackImportSummary, runContentPackImport } from './content-pack-import.core';

export { ContentPackImportSummary } from './content-pack-import.core';

/// Wrapper Nest sobre runContentPackImport (content-pack-import.core.ts) --
/// usado por POST /blog/import (subida desde el panel). scripts/import-
/// content-pack.ts llama a la misma funcion core directo, con su propio
/// PrismaClient standalone, sin pasar por este servicio ni por el contexto
/// de Nest (ver comentario en ese script).
@Injectable()
export class ContentPackImportService {
  private readonly logger = new Logger(ContentPackImportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async importFromFile(xlsxPath: string, limit: number): Promise<ContentPackImportSummary> {
    const summary = await runContentPackImport(this.prisma, xlsxPath, limit);
    this.logger.log(
      `Import de paquete de contenido: ${summary.posts} posts, ${summary.sections} secciones, ${summary.faqs} FAQs, ${summary.tags} tags.`,
    );
    return summary;
  }
}
