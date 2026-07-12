import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import got, { Got } from 'got';

interface WordpressPost {
  id: number;
  status: string;
}

interface WordpressTag {
  id: number;
  name: string;
}

interface WordpressMedia {
  id: number;
  source_url: string;
}

/// Cliente minimo de la REST API nativa de WordPress
/// (/wp-json/wp/v2/...), autenticado con un Application Password nativo
/// de WP (Basic Auth sobre HTTPS) -- no requiere ningun plugin adicional.
/// Deliberadamente NO tiene ningun metodo que cree o modifique la
/// categoria "Diario de la Salud": su ID numerico se lee de config y se
/// asume pre-creada manualmente por el cliente, para no tocar la
/// estructura existente del blog (brief secciones 3 y 12).
@Injectable()
export class WordpressClientService {
  private readonly logger = new Logger(WordpressClientService.name);
  private readonly client: Got;
  readonly diarioSaludCategoryId: number;

  constructor(config: ConfigService) {
    const baseUrl = config.get<string>('WORDPRESS_BASE_URL')!;
    const username = config.get<string>('WORDPRESS_APP_USERNAME') ?? '';
    const password = config.get<string>('WORDPRESS_APP_PASSWORD') ?? '';
    this.diarioSaludCategoryId = config.get<number>('WORDPRESS_DIARIO_SALUD_CATEGORY_ID') ?? 0;

    this.client = got.extend({
      prefixUrl: `${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2`,
      username,
      password,
      responseType: 'json',
      timeout: { request: 20_000 },
    });
  }

  async createDraftPost(params: {
    title: string;
    content: string;
    excerpt: string;
    tagIds: number[];
    featuredMediaId?: number | null;
  }): Promise<WordpressPost> {
    const response = await this.client.post<WordpressPost>('posts', {
      json: {
        title: params.title,
        content: params.content,
        excerpt: params.excerpt,
        status: 'draft',
        categories: [this.diarioSaludCategoryId],
        tags: params.tagIds,
        ...(params.featuredMediaId ? { featured_media: params.featuredMediaId } : {}),
      },
    });
    return response.body;
  }

  /// Descarga la imagen oficial (URL real de la fuente, nunca generada)
  /// y la sube a la libreria de medios de WordPress para usarla como
  /// imagen destacada. Si la fuente no trae imagen (imageUrl=null) esto
  /// nunca se llama; si la descarga o la subida fallan, se devuelve null
  /// y el articulo se publica sin imagen destacada -- una imagen rota
  /// nunca debe bloquear la publicacion de contenido ya validado.
  async uploadMediaFromUrl(imageUrl: string): Promise<number | null> {
    try {
      const imageResponse = await got.get(imageUrl, {
        responseType: 'buffer',
        timeout: { request: 20_000 },
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      });

      const contentType = imageResponse.headers['content-type'] ?? 'image/jpeg';
      const filename = this.filenameFromUrl(imageUrl);

      const uploadResponse = await this.client.post<WordpressMedia>('media', {
        body: imageResponse.body,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });

      return uploadResponse.body.id;
    } catch (err) {
      this.logger.warn(
        `No se pudo subir la imagen ${imageUrl} a WordPress: ${(err as Error).message} -- se publica sin imagen destacada`,
      );
      return null;
    }
  }

  private filenameFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const base = pathname.split('/').pop();
      return base && base.length > 0 ? base : 'diario-salud-imagen.jpg';
    } catch {
      return 'diario-salud-imagen.jpg';
    }
  }

  async publishPost(postId: number): Promise<WordpressPost> {
    const response = await this.client.post<WordpressPost>(`posts/${postId}`, {
      json: { status: 'publish' },
    });
    return response.body;
  }

  /// Los tags SI se resuelven/crean automaticamente (a diferencia de la
  /// categoria): no afectan la navegacion del sitio de la misma forma,
  /// asi que es seguro dejar que el pipeline los administre.
  async resolveOrCreateTagIds(tagNames: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const name of tagNames) {
      const existing = await this.client.get<WordpressTag[]>('tags', { searchParams: { search: name } });
      const match = existing.body.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (match) {
        ids.push(match.id);
        continue;
      }
      try {
        const created = await this.client.post<WordpressTag>('tags', { json: { name } });
        ids.push(created.body.id);
      } catch (err) {
        this.logger.warn(`No se pudo crear/resolver el tag "${name}": ${(err as Error).message}`);
      }
    }
    return ids;
  }
}
