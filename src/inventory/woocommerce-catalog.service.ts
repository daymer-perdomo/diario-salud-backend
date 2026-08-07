import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { WoocommercePendingKind, WoocommercePendingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface WoocommerceProductSummary {
  id: number;
  sku: string;
  name: string;
  permalink: string;
  image: string | null;
  stockStatus: string;
  catalogVisibility: string;
  manageStock: boolean;
  /// Cambio encolado y todavia no aplicado en WooCommerce (undefined = nada
  /// pendiente). El dashboard los usa para mostrar "pendiente de aplicar"
  /// junto al estado real, en vez de mentir diciendo que ya se aplico.
  pendingHidden?: boolean;
  pendingOutOfStock?: boolean;
  /// Ultimo intento que FALLO del lado de WordPress, con su motivo. Sin
  /// esto un fallo desapareceria de la pantalla sin dejar rastro y el admin
  /// creeria que el producto simplemente no cambio (no que su pedido murio).
  failedHidden?: boolean;
  failedHiddenError?: string | null;
  failedOutOfStock?: boolean;
  failedOutOfStockError?: string | null;
  /// Ultima vez que el plugin de WordPress subio este producto -- da idea de
  /// cuan vieja es la copia local.
  syncedAt?: Date;
}

/// Puerta de entrada del dashboard al catalogo REAL de WooCommerce (~42,300
/// productos, ver conversacion 2026-08-02) -- completamente aparte del
/// Product de este backend (~7,000, alimentado por Distrimonaco, ver
/// DistrimonacoSyncService).
///
/// POR QUE YA NO ESCRIBE DIRECTO A WOOCOMMERCE: Cloudflare (delante de
/// ecofarma.co) responde 403 "Attention Required" a TODO el trafico entrante
/// desde las IPs de datacenter de Render. Comprobado 2026-08-04: la misma
/// peticion, con el mismo User-Agent y el mismo header
/// X-EcoFarma-Backend-Secret, desde una IP residencial llega y devuelve 401
/// de WooCommerce (no 403 de Cloudflare) -- el bloqueo es por reputacion de
/// IP, no por el header ni la URL, y no hay acceso al panel de Cloudflare
/// para agregar la regla de excepcion. El trafico SALIENTE de WordPress si
/// pasa, asi que se invirtio el sentido:
///
///   - LECTURA: copia local del catalogo (WoocommerceCatalogItem), que el
///     plugin de WordPress reemplaza periodicamente via
///     POST /integration/woocommerce/catalog.
///   - ESCRITURA: cola de intenciones (WoocommercePendingChange), que el
///     plugin consume via GET /integration/woocommerce/pending-changes y
///     confirma via POST /integration/woocommerce/pending-changes/ack.
///
/// Ver IntegrationService para el lado que consume el plugin. Consecuencia
/// aceptada por el usuario: un cambio ya no es instantaneo, se aplica dentro
/// del intervalo de polling del plugin, y la busqueda deja de ser en vivo.
///
/// "Marcar como no disponible" sigue siendo catalog_visibility: "hidden"
/// (oculta el producto de tienda/categorias/buscador; la URL directa sigue
/// funcionando) -- decision explicita del usuario 2026-08-02, deliberada-
/// mente independiente de stock_status (WooCommerce ya usa ese campo para
/// su propio ajuste nativo woocommerce_hide_out_of_stock_items).
@Injectable()
export class WoocommerceCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /// Busca en la copia local. Cubre los dos casos que importan igual que
  /// antes cubria la API de WooCommerce: match exacto por SKU (el `search`
  /// de WooCommerce NUNCA matchea sku, verificado 2026-08-02) y match
  /// parcial por nombre. Acotado a 20: es para que el admin encuentre UN
  /// producto puntual, no para listar el catalogo.
  ///
  /// Si la copia local esta vacia falla con un mensaje explicito en vez de
  /// devolver "sin resultados": una lista vacia haria pensar que el producto
  /// no existe, cuando lo que falta es que el plugin de WordPress suba el
  /// catalogo por primera vez.
  async searchProducts(query: string): Promise<WoocommerceProductSummary[]> {
    const total = await this.prisma.woocommerceCatalogItem.count();
    if (total === 0) {
      throw new ServiceUnavailableException(
        'La copia local del catalogo de WooCommerce esta vacia: el plugin de WordPress todavia no la subio (POST /integration/woocommerce/catalog).',
      );
    }

    const items = await this.prisma.woocommerceCatalogItem.findMany({
      where: {
        OR: [
          { sku: { equals: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 20,
    });

    return this.withPending(items);
  }

  /// Lista lo que se marco "no disponible" desde este dashboard, mas
  /// reciente primero -- para encontrar rapido un producto que se oculto
  /// hace dias sin tener que recordar su nombre/SKU exacto.
  async listHiddenProducts() {
    return this.prisma.woocommerceHiddenProduct.findMany({ orderBy: { hiddenAt: 'desc' } });
  }

  /// Encola "marcar/desmarcar como no disponible". WoocommerceHiddenProduct
  /// NO se toca aca: ese registro refleja lo que esta oculto de verdad en
  /// WooCommerce y solo se actualiza cuando el plugin confirma que aplico el
  /// cambio (ver IntegrationService.ackPendingChanges).
  async setAvailability(
    productId: number,
    hidden: boolean,
    requestedByUserId?: string,
  ): Promise<WoocommerceProductSummary> {
    return this.enqueue(productId, WoocommercePendingKind.VISIBILITY, hidden, requestedByUserId);
  }

  /// Independiente de setAvailability: apunta a stock_status directamente
  /// (ver conversacion 2026-08-02, caso NOFERTYL 7702870002636). El plugin
  /// de WordPress debe enviar manage_stock: false junto con el stock_status
  /// -- verificado contra la API real: mientras manage_stock=true,
  /// WooCommerce SIEMPRE recalcula stock_status a partir de stock_quantity y
  /// descarta cualquier stock_status que se envie (probado en ambas
  /// direcciones). Efecto secundario aceptado: mientras quede en
  /// manage_stock=false, WooCommerce deja de rastrear la cantidad real de
  /// ESE producto puntual.
  async setStockStatus(
    productId: number,
    outOfStock: boolean,
    requestedByUserId?: string,
  ): Promise<WoocommerceProductSummary> {
    return this.enqueue(productId, WoocommercePendingKind.STOCK_STATUS, outOfStock, requestedByUserId);
  }

  /// Un solo pendiente por (producto, tipo): si el admin cambia de opinion
  /// antes de que el plugin pase, la ultima intencion reemplaza a la
  /// anterior en vez de encolar dos cambios contradictorios que se
  /// aplicarian en orden. Los ya APLICADO/FALLIDO quedan como historial.
  private async enqueue(
    productId: number,
    kind: WoocommercePendingKind,
    value: boolean,
    requestedByUserId?: string,
  ): Promise<WoocommerceProductSummary> {
    const item = await this.prisma.woocommerceCatalogItem.findUnique({ where: { id: productId } });
    if (!item) {
      throw new ServiceUnavailableException(
        `El producto ${productId} no esta en la copia local del catalogo: espera la proxima subida del plugin de WordPress.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.woocommercePendingChange.deleteMany({
        where: { productId, kind, status: WoocommercePendingStatus.PENDIENTE },
      }),
      this.prisma.woocommercePendingChange.create({
        data: { productId, kind, value, requestedByUserId },
      }),
    ]);

    const [summary] = await this.withPending([item]);
    return summary;
  }

  /// Adjunta a cada producto el ESTADO DE SU ULTIMO PEDIDO por tipo, en UNA
  /// consulta para todos (no una por producto). Se mira solo el mas reciente
  /// de cada (producto, tipo) porque es el unico que sigue vigente: si esta
  /// PENDIENTE va como "pendiente", si esta FALLIDO va como "fallo" con su
  /// motivo, y si esta APLICADO no se informa nada -- el espejo local ya
  /// refleja ese cambio, repetirlo seria ruido.
  private async withPending(
    items: Array<{
      id: number;
      sku: string;
      name: string;
      permalink: string;
      imageUrl: string | null;
      stockStatus: string;
      catalogVisibility: string;
      manageStock: boolean;
      syncedAt: Date;
    }>,
  ): Promise<WoocommerceProductSummary[]> {
    if (items.length === 0) return [];

    /// Mas reciente primero: el primero que aparece de cada (producto, tipo)
    /// es el ultimo pedido, que es el unico que interesa.
    const changes = await this.prisma.woocommercePendingChange.findMany({
      where: { productId: { in: items.map((i) => i.id) } },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => {
      const mine = changes.filter((c) => c.productId === item.id);
      const visibility = mine.find((c) => c.kind === WoocommercePendingKind.VISIBILITY);
      const stock = mine.find((c) => c.kind === WoocommercePendingKind.STOCK_STATUS);
      return {
        id: item.id,
        sku: item.sku,
        name: item.name,
        permalink: item.permalink,
        image: item.imageUrl,
        stockStatus: item.stockStatus,
        catalogVisibility: item.catalogVisibility,
        manageStock: item.manageStock,
        syncedAt: item.syncedAt,
        ...(visibility?.status === WoocommercePendingStatus.PENDIENTE
          ? { pendingHidden: visibility.value }
          : {}),
        ...(visibility?.status === WoocommercePendingStatus.FALLIDO
          ? { failedHidden: visibility.value, failedHiddenError: visibility.errorMessage }
          : {}),
        ...(stock?.status === WoocommercePendingStatus.PENDIENTE
          ? { pendingOutOfStock: stock.value }
          : {}),
        ...(stock?.status === WoocommercePendingStatus.FALLIDO
          ? { failedOutOfStock: stock.value, failedOutOfStockError: stock.errorMessage }
          : {}),
      };
    });
  }
}
