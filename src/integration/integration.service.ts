import { Injectable, Logger } from '@nestjs/common';
import { WoocommercePendingKind, WoocommercePendingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AckResultDto } from './dto/ack-pending-changes.dto';
import { CatalogItemDto } from './dto/upload-catalog.dto';

/// Payload exacto que el plugin de WordPress debe enviar en
/// PUT wp-json/wc/v3/products/{productId}. Se arma aca a proposito: el lado
/// de WordPress no debe tener que saber que "no disponible" significa
/// catalog_visibility=hidden, ni que stock_status necesita manage_stock=false
/// para sostenerse. Toda esa regla vive en este repo; el plugin solo
/// reenvia lo que le llega.
export interface PendingChangeForPlugin {
  id: string;
  productId: number;
  sku: string | null;
  name: string | null;
  kind: WoocommercePendingKind;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/// Lado de la integracion que consume el plugin de WordPress. Existe porque
/// Cloudflare bloquea con 403 todo el trafico entrante desde las IPs de
/// Render hacia ecofarma.co (diagnostico completo en
/// WoocommerceCatalogService), asi que WordPress es el que inicia siempre la
/// conexion. Este servicio es la contraparte exacta de
/// WoocommerceCatalogService: alli el dashboard encola intenciones y lee la
/// copia local; aca el plugin consume esa cola y mantiene la copia al dia.
@Injectable()
export class IntegrationService {
  private readonly logger = new Logger(IntegrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /// Cambios pendientes, mas antiguos primero (orden de intencion). El
  /// limite lo pone el backend, no el plugin, para que una cola larga no se
  /// convierta en una peticion gigante del lado de PHP.
  async listPendingChanges(limit = 50): Promise<PendingChangeForPlugin[]> {
    const changes = await this.prisma.woocommercePendingChange.findMany({
      where: { status: WoocommercePendingStatus.PENDIENTE },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    if (changes.length === 0) return [];

    /// sku/name son solo para que el plugin pueda loguear algo legible; si
    /// el producto no esta en la copia local van en null y el cambio se
    /// entrega igual (el productId es lo unico que WooCommerce necesita).
    const items = await this.prisma.woocommerceCatalogItem.findMany({
      where: { id: { in: changes.map((c) => c.productId) } },
      select: { id: true, sku: true, name: true },
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    return changes.map((c) => ({
      id: c.id,
      productId: c.productId,
      sku: byId.get(c.productId)?.sku ?? null,
      name: byId.get(c.productId)?.name ?? null,
      kind: c.kind,
      payload: this.payloadFor(c.kind, c.value),
      createdAt: c.createdAt,
    }));
  }

  /// Confirma el resultado de cada cambio. Un ok=true mueve la copia local
  /// al estado nuevo: es el unico momento en que sabemos que WooCommerce
  /// realmente cambio, y mantener el espejo fiel evita que el dashboard
  /// muestre un estado que nunca se aplico.
  ///
  /// Ignora en silencio los ids que ya no estan PENDIENTE (reintento del
  /// plugin tras un timeout, o un ack duplicado): confirmar dos veces el
  /// mismo cambio no debe ser un error.
  async ackPendingChanges(results: AckResultDto[]): Promise<{ applied: number; failed: number; ignored: number }> {
    let applied = 0;
    let failed = 0;
    let ignored = 0;

    for (const result of results) {
      const change = await this.prisma.woocommercePendingChange.findUnique({ where: { id: result.id } });
      if (!change || change.status !== WoocommercePendingStatus.PENDIENTE) {
        ignored++;
        continue;
      }

      if (!result.ok) {
        await this.prisma.woocommercePendingChange.update({
          where: { id: change.id },
          data: {
            status: WoocommercePendingStatus.FALLIDO,
            errorMessage: result.error ?? 'El plugin de WordPress no reporto un motivo',
            appliedAt: new Date(),
          },
        });
        failed++;
        this.logger.warn(
          `Cambio ${change.kind} del producto ${change.productId} fallo en WordPress: ${result.error ?? 'sin motivo'}`,
        );
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.woocommercePendingChange.update({
          where: { id: change.id },
          data: { status: WoocommercePendingStatus.APLICADO, appliedAt: new Date() },
        });

        const item = await tx.woocommerceCatalogItem.findUnique({ where: { id: change.productId } });
        if (!item) return;

        if (change.kind === WoocommercePendingKind.VISIBILITY) {
          await tx.woocommerceCatalogItem.update({
            where: { id: item.id },
            data: { catalogVisibility: change.value ? 'hidden' : 'visible' },
          });
          /// WoocommerceHiddenProduct es el UNICO registro consultable de
          /// que esta oculto ahora mismo (WooCommerce no permite filtrar por
          /// catalog_visibility via su API) -- ver listHiddenProducts.
          if (change.value) {
            await tx.woocommerceHiddenProduct.upsert({
              where: { id: item.id },
              update: { sku: item.sku, name: item.name },
              create: { id: item.id, sku: item.sku, name: item.name },
            });
          } else {
            await tx.woocommerceHiddenProduct.deleteMany({ where: { id: item.id } });
          }
        } else {
          await tx.woocommerceCatalogItem.update({
            where: { id: item.id },
            data: { stockStatus: change.value ? 'outofstock' : 'instock', manageStock: false },
          });
        }
      });
      applied++;
    }

    return { applied, failed, ignored };
  }

  /// Reemplaza/actualiza una tanda del catalogo local. Es upsert, NO borra
  /// lo que no venga en la tanda: el plugin sube por paginas y una peticion
  /// no conoce el catalogo completo, asi que borrar lo ausente vaciaria el
  /// indice en cuanto una pagina falle a mitad de camino. Consecuencia
  /// aceptada: un producto eliminado en WooCommerce sigue apareciendo en la
  /// busqueda del dashboard hasta que alguien lo limpie; si se intenta
  /// cambiarlo, el cambio queda FALLIDO con el error real de WooCommerce.
  async uploadCatalog(items: CatalogItemDto[]): Promise<{ upserted: number }> {
    for (const item of items) {
      const data = {
        sku: item.sku,
        name: item.name,
        permalink: item.permalink,
        imageUrl: item.imageUrl ?? null,
        stockStatus: item.stockStatus,
        catalogVisibility: item.catalogVisibility,
        manageStock: item.manageStock,
      };
      await this.prisma.woocommerceCatalogItem.upsert({
        where: { id: item.id },
        update: data,
        create: { id: item.id, ...data },
      });
    }
    return { upserted: items.length };
  }

  private payloadFor(kind: WoocommercePendingKind, value: boolean): Record<string, unknown> {
    if (kind === WoocommercePendingKind.VISIBILITY) {
      return { catalog_visibility: value ? 'hidden' : 'visible' };
    }
    /// manage_stock: false es obligatorio, no un extra: mientras
    /// manage_stock=true WooCommerce recalcula stock_status desde
    /// stock_quantity y descarta el stock_status enviado (verificado contra
    /// la API real 2026-08-02, caso NOFERTYL 7702870002636).
    return { manage_stock: false, stock_status: value ? 'outofstock' : 'instock' };
  }
}
