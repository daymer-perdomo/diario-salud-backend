import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Article, Source } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withDefaultImage } from '../common/default-article-image.util';

type ArticleWithSource = Article & { source: Source };

/// Espejo de articulos PUBLICADO hacia el WordPress de EcoFarma (crea la
/// entrada real en la categoria "Diario de la Salud" via wp-json/wp/v2/posts,
/// autenticado con una Application Password). Reemplaza a la automatizacion
/// externa que cumplia este mismo rol -- nunca localizada (ni en este repo,
/// ni en plugins/snippets/temas de WordPress) tras dejar de sincronizar
/// articulos nuevos desde el cambio de dominio del backend (2026-08-03).
///
/// Idempotente por diseno: solo procesa articulos con wordpressPostId null,
/// y jamas reintenta uno que ya lo tiene -- evita duplicados aunque el
/// intervalo se solape con una corrida manual (POST /wordpress/sync-now).
@Injectable()
export class WordpressPublishService implements OnModuleInit {
  private readonly logger = new Logger(WordpressPublishService.name);
  private syncing = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  private isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('WORDPRESS_BASE_URL') &&
        this.config.get<string>('WORDPRESS_USERNAME') &&
        this.config.get<string>('WORDPRESS_APP_PASSWORD') &&
        this.config.get<number>('WORDPRESS_CATEGORY_ID'),
    );
  }

  onModuleInit() {
    if (!this.isConfigured()) {
      this.logger.warn('WORDPRESS_BASE_URL/USERNAME/APP_PASSWORD/CATEGORY_ID no configurados -- espejo a WordPress deshabilitado.');
      return;
    }

    const minutes = this.config.get<number>('WORDPRESS_SYNC_INTERVAL_MINUTES') ?? 15;
    const handle = setInterval(() => {
      this.syncNow().catch((err) => this.logger.error(`Sincronizacion a WordPress fallo: ${(err as Error).message}`));
    }, minutes * 60_000);
    this.scheduler.addInterval('wordpress-publish-sync', handle);
    this.logger.log(`Espejo a WordPress programado cada ${minutes} minuto(s).`);
  }

  private authHeader(): string {
    const username = this.config.get<string>('WORDPRESS_USERNAME')!;
    const appPassword = this.config.get<string>('WORDPRESS_APP_PASSWORD')!;
    return 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
  }

  /// Headers comunes a toda llamada a wp-json/wp/v2/* -- incluye
  /// X-EcoFarma-Backend-Secret cuando esta configurado, para que una regla
  /// de firewall de Cloudflare pueda dejar pasar este trafico sin
  /// depender de la IP de salida de Render (ver comentario de
  /// WORDPRESS_BACKEND_SECRET en env.validation.ts).
  private wordpressHeaders(extra: Record<string, string>): Record<string, string> {
    const secret = this.config.get<string>('WORDPRESS_BACKEND_SECRET');
    return {
      Authorization: this.authHeader(),
      'User-Agent': 'EcoFarma-Backend/1.0 (+https://ecofarma.co)',
      ...(secret ? { 'X-EcoFarma-Backend-Secret': secret } : {}),
      ...extra,
    };
  }

  /// Sube la imagen del articulo (real o DEFAULT_ARTICLE_IMAGE_URL) a la
  /// biblioteca de medios de WordPress. Devuelve el ID de medio para usarlo
  /// como featured_media, o null si falla -- un fallo aqui NUNCA debe
  /// impedir crear la entrada (se publica sin imagen destacada).
  private async uploadFeaturedImage(article: ArticleWithSource): Promise<number | null> {
    const baseUrl = this.config.get<string>('WORDPRESS_BASE_URL')!;
    const withImage = withDefaultImage(article);
    if (!withImage.imageUrl) return null;

    try {
      const imageRes = await fetch(withImage.imageUrl);
      if (!imageRes.ok) throw new Error(`no se pudo descargar la imagen (${imageRes.status})`);
      const bytes = Buffer.from(await imageRes.arrayBuffer());
      const contentType = imageRes.headers.get('content-type') ?? 'image/webp';
      const extension = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';

      const uploadRes = await fetch(`${baseUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: this.wordpressHeaders({
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="articulo-${article.id}.${extension}"`,
        }),
        body: bytes,
      });
      if (!uploadRes.ok) throw new Error(`WordPress rechazo la imagen (${uploadRes.status}): ${await uploadRes.text()}`);
      const media = (await uploadRes.json()) as { id: number };
      return media.id;
    } catch (err) {
      this.logger.warn(`Articulo ${article.id}: no se pudo subir la imagen destacada -- ${(err as Error).message}`);
      return null;
    }
  }

  /// Cuerpo en el mismo orden de secciones del brief (seccion 11): Resumen,
  /// Puntos clave, Cuerpo, Por que es importante, Fuente. El aviso de
  /// contenido republicado NO se agrega aqui -- ya lo inserta el snippet de
  /// WPCode "EcoFarma - Disclaimer contenido republicado" via el filtro
  /// the_content, para toda entrada de esta categoria.
  private buildContent(article: ArticleWithSource): string {
    const paragraphs = (article.rewrittenContent ?? '')
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${p}</p>`)
      .join('\n');

    const keyPoints = article.rewrittenKeyPoints ?? [];
    const keyPointsHtml = keyPoints.length
      ? `<h2>Puntos clave</h2>\n<ul>\n${keyPoints.map((k) => `<li>${k}</li>`).join('\n')}\n</ul>`
      : '';

    const whyItMattersHtml = article.rewrittenWhyItMatters
      ? `<h2>Por qué es importante</h2>\n<p>${article.rewrittenWhyItMatters}</p>`
      : '';

    const publishedAt = article.sourcePublishedAt.toLocaleDateString('es-CO', { dateStyle: 'long' });
    const sourceHtml = `<p><em>Fuente: <a href="${article.sourceUrl}" target="_blank" rel="noopener noreferrer">${article.sourceInstitution}</a> — ${publishedAt}</em></p>`;

    return [article.rewrittenSummary ? `<p>${article.rewrittenSummary}</p>` : '', keyPointsHtml, paragraphs, whyItMattersHtml, sourceHtml]
      .filter(Boolean)
      .join('\n\n');
  }

  private async publishOne(article: ArticleWithSource): Promise<void> {
    const baseUrl = this.config.get<string>('WORDPRESS_BASE_URL')!;
    const categoryId = this.config.get<number>('WORDPRESS_CATEGORY_ID')!;

    const featuredMediaId = await this.uploadFeaturedImage(article);

    const res = await fetch(`${baseUrl}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: this.wordpressHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        title: article.rewrittenTitle ?? article.originalTitle,
        content: this.buildContent(article),
        status: 'publish',
        categories: [categoryId],
        ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      }),
    });

    if (!res.ok) {
      throw new Error(`WordPress rechazo la entrada (${res.status}): ${await res.text()}`);
    }
    const post = (await res.json()) as { id: number };

    await this.prisma.article.update({ where: { id: article.id }, data: { wordpressPostId: post.id } });
    this.logger.log(`Articulo ${article.id} sincronizado a WordPress como post ${post.id}.`);
  }

  /// Idempotente y seguro de llamar tantas veces como haga falta (tanto
  /// desde el intervalo programado como desde POST /wordpress/sync-now) --
  /// solo toma articulos PUBLICADO sin wordpressPostId, asi que dos
  /// corridas solapadas en el peor caso reintentan lo mismo, nunca duplican
  /// una entrada ya creada exitosamente.
  async syncNow(): Promise<{ checked: number; created: number; errors?: Array<{ articleId: string; message: string }> }> {
    if (!this.isConfigured()) {
      this.logger.warn('syncNow() llamado sin WORDPRESS_* configurado -- se omite.');
      return { checked: 0, created: 0 };
    }
    if (this.syncing) {
      this.logger.warn('Ya hay una sincronizacion a WordPress en curso, se omite esta invocacion.');
      return { checked: 0, created: 0 };
    }
    this.syncing = true;
    try {
      const candidates = await this.prisma.article.findMany({
        where: { state: 'PUBLICADO', wordpressPostId: null },
        include: { source: true },
        orderBy: { publishedAt: 'asc' },
      });

      let created = 0;
      const errors: Array<{ articleId: string; message: string }> = [];
      for (const article of candidates) {
        try {
          await this.publishOne(article);
          created++;
        } catch (err) {
          const message = (err as Error).message;
          this.logger.warn(`Articulo ${article.id}: no se pudo sincronizar a WordPress -- ${message}`);
          errors.push({ articleId: article.id, message });
        }
      }

      this.logger.log(`Espejo a WordPress: ${candidates.length} candidatos, ${created} creados.`);
      return { checked: candidates.length, created, errors };
    } finally {
      this.syncing = false;
    }
  }
}
