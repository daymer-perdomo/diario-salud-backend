import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

interface DistrimonacoProducto {
  CodigoBarras: string;
  NombreProducto: string;
  Laboratorio: string;
  Stock: number;
  PrecioUnitario: number;
  CodigoProveedor: string;
  Invima: string;
  EstadoProducto: string;
  FechaActualizacion: string;
}

/// Marca en Product.sourceFile los productos que vienen de esta sync (no
/// de import-inventory-master.ts ni de creacion manual en el panel).
const SOURCE_TAG = 'distrimonaco-api-sync';

/// Upserts en chunks paralelos en vez de uno por uno (con ~6800 productos
/// por corrida, secuencial puro tardaria varios minutos) ni todos a la
/// vez (saturaria el pool de conexiones de Prisma).
const SYNC_CHUNK_SIZE = 25;

/// Sincroniza periodicamente el catalogo de Distrimonaco (GET
/// ProductosStock) hacia Product/ProductStock. NUNCA se llama esta API
/// en vivo por cada mensaje del chatbot -- se probo en vivo (ver plan) que
/// el endpoint no soporta filtros ni paginacion (cualquier query param
/// devuelve 500 "Cannot find column 1") y devuelve el catalogo COMPLETO
/// de una sola vez (~6800 productos, ~2.2MB) -- inviable por request de
/// chat. El chatbot (InventoryService) solo lee la copia local que este
/// servicio mantiene actualizada.
///
/// La API no reporta sucursal (un solo Stock por producto) -- se guarda
/// bajo DISTRIMONACO_BRANCH_CODE (default "PRINCIPAL") hasta que se
/// confirme con el usuario/Distrimonaco si es un consolidado o una
/// bodega especifica.
@Injectable()
export class DistrimonacoSyncService implements OnModuleInit {
  private readonly logger = new Logger(DistrimonacoSyncService.name);
  private syncing = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const url = this.config.get<string>('DISTRIMONACO_API_URL');
    const apiKey = this.config.get<string>('DISTRIMONACO_API_KEY');
    if (!url || !apiKey) {
      this.logger.warn('DISTRIMONACO_API_URL/DISTRIMONACO_API_KEY no configurados -- sincronizacion de inventario deshabilitada.');
      return;
    }

    const minutes = this.config.get<number>('DISTRIMONACO_SYNC_INTERVAL_MINUTES') ?? 60;
    const handle = setInterval(() => {
      this.syncNow().catch((err) => this.logger.error(`Sincronizacion programada fallo: ${(err as Error).message}`));
    }, minutes * 60_000);
    this.scheduler.addInterval('distrimonaco-sync', handle);
    this.logger.log(`Sincronizacion con Distrimonaco programada cada ${minutes} minuto(s).`);
  }

  private async fetchCatalog(): Promise<DistrimonacoProducto[]> {
    const url = this.config.get<string>('DISTRIMONACO_API_URL');
    const apiKey = this.config.get<string>('DISTRIMONACO_API_KEY');
    if (!url || !apiKey) {
      throw new Error('DISTRIMONACO_API_URL/DISTRIMONACO_API_KEY no configurados');
    }

    const res = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
    if (!res.ok) {
      throw new Error(`Distrimonaco API error (${res.status}): ${await res.text()}`);
    }

    const outer = (await res.json()) as { mensaje: string; response: string };
    if (outer.mensaje !== 'OK') {
      throw new Error(`Distrimonaco API respondio mensaje="${outer.mensaje}"`);
    }
    // "response" es un STRING con JSON escapado adentro, no un objeto anidado.
    const inner = JSON.parse(outer.response) as { productos: DistrimonacoProducto[] };
    return inner.productos;
  }

  /// Idempotente (upsert por sku/branchId, igual que import-inventory-
  /// master.ts) -- se puede llamar tantas veces como haga falta, tanto
  /// desde el intervalo programado como desde POST /inventory/sync-now.
  async syncNow(): Promise<{ itemsSynced: number }> {
    if (this.syncing) {
      this.logger.warn('Ya hay una sincronizacion en curso, se omite esta invocacion.');
      return { itemsSynced: 0 };
    }
    this.syncing = true;
    const run = await this.prisma.inventorySyncRun.create({ data: {} });

    try {
      const productos = await this.fetchCatalog();
      const branch = await this.getOrCreateDefaultBranch();

      let synced = 0;
      for (let i = 0; i < productos.length; i += SYNC_CHUNK_SIZE) {
        const chunk = productos.slice(i, i + SYNC_CHUNK_SIZE);
        await Promise.all(chunk.map((p) => this.upsertProducto(p, branch.id)));
        synced += chunk.length;
      }

      await this.prisma.inventorySyncRun.update({
        where: { id: run.id },
        data: { status: 'COMPLETADO', itemsSynced: synced, finishedAt: new Date() },
      });
      this.logger.log(`Sincronizacion con Distrimonaco completa: ${synced} productos.`);
      return { itemsSynced: synced };
    } catch (err) {
      await this.prisma.inventorySyncRun.update({
        where: { id: run.id },
        data: { status: 'FALLIDO', errorMessage: (err as Error).message, finishedAt: new Date() },
      });
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  /// El nombre de la sucursal es lo unico de este servicio que el LLM ve
  /// y le puede repetir al cliente (ver ChatbotService.gatherFacts,
  /// stockByBranch.branch) -- NUNCA debe mencionar a Distrimonaco (el
  /// proveedor mayorista de los datos), solo la marca de cara al publico
  /// es EcoFarma. Pedido explicito del usuario 2026-07-29.
  private async getOrCreateDefaultBranch() {
    const code = this.config.get<string>('DISTRIMONACO_BRANCH_CODE') ?? 'PRINCIPAL';
    return this.prisma.branch.upsert({
      where: { code },
      update: {},
      create: { code, name: 'Sucursal Principal' },
    });
  }

  /// name/labName/invimaRegistration/etc SIEMPRE se pisan con lo que
  /// reporta Distrimonaco -- es el catalogo real del proveedor. En
  /// cambio activeIngredient/category/description/requiresPrescription/
  /// hiddenFromCatalog (ver UpdateProductDto) nunca se tocan aca: la API
  /// no los reporta (o, en el caso de hiddenFromCatalog, es una decision
  /// manual del admin que no debe revertirse en cada sync), siempre son
  /// manuales desde el panel.
  private async upsertProducto(p: DistrimonacoProducto, branchId: string) {
    const isActive = p.EstadoProducto === 'Activo';
    const data = {
      name: p.NombreProducto,
      labName: p.Laboratorio?.trim() || null,
      supplierCode: p.CodigoProveedor || null,
      invimaRegistration: p.Invima || null,
      externalUpdatedAt: p.FechaActualizacion ? new Date(p.FechaActualizacion) : null,
      isActive,
      sourceFile: SOURCE_TAG,
    };

    const product = await this.prisma.product.upsert({
      where: { sku: p.CodigoBarras },
      update: data,
      create: { sku: p.CodigoBarras, ...data },
    });

    await this.prisma.productStock.upsert({
      where: { productId_branchId: { productId: product.id, branchId } },
      update: { quantity: p.Stock, price: p.PrecioUnitario },
      create: { productId: product.id, branchId, quantity: p.Stock, price: p.PrecioUnitario },
    });
  }
}
