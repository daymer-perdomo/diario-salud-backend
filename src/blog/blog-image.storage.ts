import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';

/// Carpeta servida en vivo por ServeStaticModule (rootPath apunta a
/// <repo>/public -- ver AppModule), montada como Render Disk en produccion
/// (render.yaml) para que las imagenes sobrevivan a cada deploy -- sin
/// disco persistente, Render reinicia el filesystem del contenedor en
/// cada deploy/restart y las imagenes subidas se perderian.
export const BLOG_IMAGE_UPLOAD_DIR = join(process.cwd(), 'public', 'uploads', 'blog');

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const BLOG_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/// Mismo dominio absoluto que DEFAULT_ARTICLE_IMAGE_URL (ver
/// src/common/default-article-image.util.ts) -- una URL relativa se
/// resolveria contra el dominio del consumidor (WordPress) en vez del
/// backend.
export const BLOG_API_PUBLIC_BASE_URL = 'https://diario.ecofarma.co';

export function blogImagePublicUrl(filename: string): string {
  return `${BLOG_API_PUBLIC_BASE_URL}/uploads/blog/${filename}`;
}

export const blogImageMulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(BLOG_IMAGE_UPLOAD_DIR)) {
        mkdirSync(BLOG_IMAGE_UPLOAD_DIR, { recursive: true });
      }
      cb(null, BLOG_IMAGE_UPLOAD_DIR);
    },
    // Nombre generado, nunca el original -- evita path traversal y
    // colisiones entre posts distintos subiendo un archivo homonimo.
    filename: (_req, file, cb) => {
      const ext = ALLOWED_MIME_TYPES[file.mimetype] ?? extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  fileFilter: (_req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, accept: boolean) => void) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      cb(new BadRequestException('Formato de imagen no soportado -- usa JPG, PNG, WEBP o GIF'), false);
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: BLOG_IMAGE_MAX_BYTES },
};
