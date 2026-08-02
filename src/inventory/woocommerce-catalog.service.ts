import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
}

interface WoocommerceProductApiResponse {
  id: number;
  sku: string;
  name: string;
  permalink: string;
  images?: Array<{ src: string }>;
  stock_status: string;
  catalog_visibility: string;
  manage_stock: boolean;
}

/// Unico punto de escritura hacia el catalogo REAL de WooCommerce (~42,300
/// productos, ver conversacion 2026-08-02) -- completamente aparte del
/// Product de este backend (~7,000, alimentado por Distrimonaco, ver
/// DistrimonacoSyncService). No existe copia local del catalogo de
/// WooCommerce: la busqueda siempre es en vivo contra su API REST.
///
/// "Marcar como no disponible" = catalog_visibility: "hidden" (oculta el
/// producto de tienda/categorias/buscador; la URL directa sigue
/// funcionando) -- decision explicita del usuario 2026-08-02, deliberada-
/// mente independiente de stock_status (WooCommerce ya usa ese campo para
/// su propio ajuste nativo woocommerce_hide_out_of_stock_items).
@Injectable()
export class WoocommerceCatalogService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private baseUrl(): string {
    const url = this.config.get<string>('WOOCOMMERCE_API_URL');
    if (!url) throw new ServiceUnavailableException('WOOCOMMERCE_API_URL no configurado');
    return url;
  }

  private authHeader(): string {
    const key = this.config.get<string>('WOOCOMMERCE_CONSUMER_KEY');
    const secret = this.config.get<string>('WOOCOMMERCE_CONSUMER_SECRET');
    if (!key || !secret) throw new ServiceUnavailableException('WOOCOMMERCE_CONSUMER_KEY/SECRET no configurados');
    return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
  }

  private toSummary(p: WoocommerceProductApiResponse): WoocommerceProductSummary {
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      permalink: p.permalink,
      image: p.images?.[0]?.src ?? null,
      stockStatus: p.stock_status,
      catalogVisibility: p.catalog_visibility,
      manageStock: p.manage_stock,
    };
  }

  private async fetchProducts(params: string): Promise<WoocommerceProductApiResponse[]> {
    const res = await fetch(`${this.baseUrl()}/products?${params}`, {
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok) {
      throw new Error(`WooCommerce API error (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as WoocommerceProductApiResponse[];
  }

  /// `search` de WooCommerce solo matchea titulo/contenido, NUNCA sku
  /// (verificado 2026-08-02: buscar el EAN exacto de un producto por
  /// `search` devuelve vacio aunque el producto exista) -- por eso se
  /// combinan `search` (nombre) y `sku` (match exacto) y se deduplica por
  /// id. Acotado a 20 resultados por rama: es para que el admin encuentre
  /// UN producto puntual desde el dashboard, no para listar el catalogo.
  async searchProducts(query: string): Promise<WoocommerceProductSummary[]> {
    const [byName, bySku] = await Promise.all([
      this.fetchProducts(`search=${encodeURIComponent(query)}&per_page=20`),
      this.fetchProducts(`sku=${encodeURIComponent(query)}&per_page=20`),
    ]);

    const byId = new Map<number, WoocommerceProductApiResponse>();
    for (const p of [...bySku, ...byName]) byId.set(p.id, p);
    return [...byId.values()].map((p) => this.toSummary(p));
  }

  private async updateProduct(productId: number, data: Record<string, unknown>): Promise<WoocommerceProductSummary> {
    const res = await fetch(`${this.baseUrl()}/products/${productId}`, {
      method: 'PUT',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`WooCommerce API error (${res.status}): ${await res.text()}`);
    }
    const p = (await res.json()) as WoocommerceProductApiResponse;
    return this.toSummary(p);
  }

  /// Ademas de escribir en WooCommerce, refleja el cambio en
  /// WoocommerceHiddenProduct -- es el UNICO registro consultable de que
  /// esta oculto ahora mismo (ver listHiddenProducts, y el comentario del
  /// modelo en schema.prisma sobre por que hace falta esta tabla local).
  async setAvailability(productId: number, hidden: boolean): Promise<WoocommerceProductSummary> {
    const summary = await this.updateProduct(productId, { catalog_visibility: hidden ? 'hidden' : 'visible' });
    if (hidden) {
      await this.prisma.woocommerceHiddenProduct.upsert({
        where: { id: productId },
        update: { sku: summary.sku, name: summary.name },
        create: { id: productId, sku: summary.sku, name: summary.name },
      });
    } else {
      await this.prisma.woocommerceHiddenProduct.deleteMany({ where: { id: productId } });
    }
    return summary;
  }

  /// Lista lo que se marco "no disponible" desde este dashboard, mas
  /// reciente primero -- para encontrar rapido un producto que se oculto
  /// hace dias sin tener que recordar su nombre/SKU exacto.
  async listHiddenProducts() {
    return this.prisma.woocommerceHiddenProduct.findMany({ orderBy: { hiddenAt: 'desc' } });
  }

  /// Independiente de setAvailability: esto pisa stock_status directamente
  /// (ver conversacion 2026-08-02, caso NOFERTYL 7702870002636). Verificado
  /// contra la API real: mientras manage_stock=true, WooCommerce SIEMPRE
  /// recalcula stock_status a partir de stock_quantity y descarta
  /// cualquier stock_status que se envie (probado en ambas direcciones).
  /// Por eso, para que el override manual del admin realmente se sostenga
  /// -- independiente del stock real, que es justo lo pedido -- hay que
  /// apagar manage_stock junto con el cambio. Efecto secundario aceptado:
  /// mientras quede en manage_stock=false, WooCommerce deja de rastrear la
  /// cantidad real de ESE producto puntual (si el pipeline externo
  /// Distrimonaco->WooCommerce, fuera de este repo, lo vuelve a prender
  /// despues, gana esa sync -- mismo patron de riesgo que isActive con
  /// DistrimonacoSyncService en este backend).
  async setStockStatus(productId: number, outOfStock: boolean): Promise<WoocommerceProductSummary> {
    return this.updateProduct(productId, {
      manage_stock: false,
      stock_status: outOfStock ? 'outofstock' : 'instock',
    });
  }
}
