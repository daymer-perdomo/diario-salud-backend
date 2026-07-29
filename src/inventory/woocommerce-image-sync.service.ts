import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/// Rellena Product.imageUrl consultando la API REST de WooCommerce
/// (solo lectura) por match EXACTO de sku -- el sku local es el
/// CodigoBarras de Distrimonaco (ver DistrimonacoSyncService) y coincide
/// tal cual con el sku de WooCommerce para la gran mayoria del catalogo
/// (verificado: 29/30 en una muestra aleatoria, ver conversacion con el
/// usuario 2026-07-29).
///
/// Deliberadamente NUNCA empareja por nombre: el catalogo tiene
/// presentaciones/dosis distintas del mismo principio activo (ej.
/// Carvedilol 6.25/12.5/25 mg) y un match aproximado podria mostrarle al
/// cliente la imagen de una dosis equivocada. Si el sku no matchea
/// exacto, el producto se queda sin imagen (el chatbot usa
/// DEFAULT_PRODUCT_IMAGE_URL) en vez de arriesgar un match incorrecto.
@Injectable()
export class WoocommerceImageSyncService implements OnModuleInit {
  private readonly logger = new Logger(WoocommerceImageSyncService.name);
  private syncing = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const url = this.config.get<string>('WOOCOMMERCE_API_URL');
    const key = this.config.get<string>('WOOCOMMERCE_CONSUMER_KEY');
    const secret = this.config.get<string>('WOOCOMMERCE_CONSUMER_SECRET');
    if (!url || !key || !secret) {
      this.logger.warn('WOOCOMMERCE_API_URL/CONSUMER_KEY/CONSUMER_SECRET no configurados -- backfill de imagenes deshabilitado.');
      return;
    }

    const minutes = this.config.get<number>('WOOCOMMERCE_IMAGE_SYNC_INTERVAL_MINUTES') ?? 10;
    const handle = setInterval(() => {
      this.syncNow().catch((err) => this.logger.error(`Backfill de imagenes fallo: ${(err as Error).message}`));
    }, minutes * 60_000);
    this.scheduler.addInterval('woocommerce-image-sync', handle);
    this.logger.log(`Backfill de imagenes de WooCommerce programado cada ${minutes} minuto(s).`);
  }

  private authHeader(): string {
    const key = this.config.get<string>('WOOCOMMERCE_CONSUMER_KEY')!;
    const secret = this.config.get<string>('WOOCOMMERCE_CONSUMER_SECRET')!;
    return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
  }

  /// Busca UN producto en WooCommerce por sku exacto. Devuelve la URL de
  /// la primera imagen si existe, o null si el sku no matchea nada o el
  /// producto no tiene imagen cargada.
  private async lookupImageBySku(sku: string): Promise<string | null> {
    const baseUrl = this.config.get<string>('WOOCOMMERCE_API_URL')!;
    const res = await fetch(`${baseUrl}/products?sku=${encodeURIComponent(sku)}`, {
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok) {
      throw new Error(`WooCommerce API error (${res.status}): ${await res.text()}`);
    }
    const products = (await res.json()) as Array<{ images?: Array<{ src: string }> }>;
    return products[0]?.images?.[0]?.src ?? null;
  }

  /// Idempotente y seguro de llamar tantas veces como haga falta (tanto
  /// desde el intervalo programado como desde POST
  /// /inventory/sync-images-now) -- procesa un lote acotado por corrida
  /// (WOOCOMMERCE_IMAGE_SYNC_BATCH_SIZE) para no saturar la API de
  /// WooCommerce ni bloquear el arranque con ~6800 productos de una vez.
  async syncNow(): Promise<{ checked: number; updated: number }> {
    if (this.syncing) {
      this.logger.warn('Ya hay un backfill de imagenes en curso, se omite esta invocacion.');
      return { checked: 0, updated: 0 };
    }
    this.syncing = true;
    try {
      const batchSize = this.config.get<number>('WOOCOMMERCE_IMAGE_SYNC_BATCH_SIZE') ?? 100;
      // orderBy id (no updatedAt): DistrimonacoSyncService toca el
      // updatedAt de TODOS los productos en cada una de sus corridas, asi
      // que ordenar por updatedAt hacia estos candidatos no garantiza
      // avanzar -- con id (estable) cada corrida cubre el siguiente lote
      // real, sin repetir ni saltarse productos entre ejecuciones.
      const candidates = await this.prisma.product.findMany({
        where: { imageUrl: null, isActive: true },
        select: { id: true, sku: true },
        take: batchSize,
        orderBy: { id: 'asc' },
      });

      let updated = 0;
      for (const product of candidates) {
        try {
          const imageUrl = await this.lookupImageBySku(product.sku);
          if (imageUrl) {
            await this.prisma.product.update({ where: { id: product.id }, data: { imageUrl } });
            updated++;
          }
        } catch (err) {
          this.logger.warn(`No se pudo consultar WooCommerce para sku=${product.sku}: ${(err as Error).message}`);
        }
      }

      this.logger.log(`Backfill de imagenes: ${candidates.length} revisados, ${updated} actualizados.`);
      return { checked: candidates.length, updated };
    } finally {
      this.syncing = false;
    }
  }
}
