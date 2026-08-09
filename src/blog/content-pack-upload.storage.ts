import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import * as os from 'os';

/// Subida transitoria del panel (POST /blog/import): a diferencia de las
/// imagenes de post (blog-image.storage.ts), este archivo NUNCA se sirve en
/// vivo ni necesita sobrevivir a un deploy -- se procesa una sola vez
/// (ContentPackImportService) y se borra apenas termina, exista error o no.
/// Por eso vive en el tmpdir del sistema, no en public/uploads.
const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Algunos navegadores/proxies etiquetan .xlsx con el mimetype viejo de
  // Excel -- se acepta igual y se valida por extension como respaldo.
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

export const CONTENT_PACK_MAX_BYTES = 25 * 1024 * 1024;

export const contentPackUploadMulterOptions = {
  storage: diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `content-pack-${randomUUID()}.xlsx`),
  }),
  fileFilter: (_req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) => {
    const looksLikeXlsx = file.originalname.toLowerCase().endsWith('.xlsx');
    if (!looksLikeXlsx && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new BadRequestException('Formato no soportado -- sube un archivo .xlsx'), false);
      return;
    }
    if (!looksLikeXlsx) {
      cb(new BadRequestException('El archivo debe tener extensión .xlsx'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: CONTENT_PACK_MAX_BYTES },
};
