import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpsertStockDto } from './dto/upsert-stock.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { CreateSynonymDto } from './dto/create-synonym.dto';
import { UpdateSynonymDto } from './dto/update-synonym.dto';
import { CreateBlacklistEntryDto } from './dto/create-blacklist-entry.dto';
import { CreateProductDto } from './dto/create-product.dto';

const PRODUCT_WITH_STOCK_INCLUDE = { stock: { include: { branch: true } } } as const;

/// Unico punto de lectura de inventario tanto para el panel admin
/// (InventoryController) como para el chatbot (ChatbotService, via
/// searchProducts/findAlternatives) -- el LLM del chatbot NUNCA consulta
/// Prisma directamente, siempre pasa por aca (ver plan: "el LLM nunca
/// inventa stock/precio").
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllProducts(query: QueryProductsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { sku: { contains: query.q, mode: 'insensitive' as const } },
              { activeIngredient: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: PRODUCT_WITH_STOCK_INCLUDE,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async findOneProduct(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: PRODUCT_WITH_STOCK_INCLUDE });
    if (!product) throw new NotFoundException(`Producto ${id} no encontrado`);
    return product;
  }

  /// Usado por ChatCartService al agregar un item -- el frontend solo
  /// conoce el sku (lo que ya se le mostro en la tabla de productos), no
  /// el id interno.
  async findBySku(sku: string) {
    return this.prisma.product.findUnique({ where: { sku }, include: PRODUCT_WITH_STOCK_INCLUDE });
  }

  /// Alta manual de un producto desde el panel, entre importaciones de
  /// Excel/sincronizaciones de Distrimonaco -- hasta ahora un producto
  /// solo podia crearse via esos dos caminos masivos, nunca uno a uno.
  /// sourceFile queda marcado "manual-panel" para distinguirlo en
  /// trazabilidad, igual que Distrimonaco marca el suyo (ver
  /// DistrimonacoSyncService.SOURCE_TAG).
  async createProduct(dto: CreateProductDto) {
    const existing = await this.prisma.product.findUnique({ where: { sku: dto.sku.trim() } });
    if (existing) throw new ConflictException(`Ya existe un producto con el SKU ${dto.sku.trim()}`);

    return this.prisma.product.create({
      data: {
        sku: dto.sku.trim(),
        name: dto.name.trim(),
        activeIngredient: dto.activeIngredient?.trim() || null,
        category: dto.category?.trim() || null,
        description: dto.description?.trim() || null,
        requiresPrescription: dto.requiresPrescription ?? false,
        sourceFile: 'manual-panel',
      },
      include: PRODUCT_WITH_STOCK_INCLUDE,
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.findOneProduct(id);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  /// Upsert deliberado (no PATCH puro): la primera vez que se registra
  /// stock de un producto en una sucursal todavia no existe la fila de
  /// ProductStock (el import de Excel puede haber traido el producto sin
  /// stock en todas las sucursales todavia).
  async upsertStock(productId: string, branchId: string, dto: UpsertStockDto) {
    await this.findOneProduct(productId);
    const branch = await this.prisma.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new NotFoundException(`Sucursal ${branchId} no encontrada`);

    return this.prisma.productStock.upsert({
      where: { productId_branchId: { productId, branchId } },
      update: { quantity: dto.quantity, price: dto.price },
      create: { productId, branchId, quantity: dto.quantity, price: dto.price },
      include: { branch: true },
    });
  }

  async findAllBranches() {
    return this.prisma.branch.findMany({ orderBy: { name: 'asc' } });
  }

  /// Visibilidad de las corridas de DistrimonacoSyncService desde el
  /// panel -- el admin necesita saber si la ultima sincronizacion
  /// realmente funciono antes de confiar en que el chatbot responde con
  /// stock actualizado.
  async findRecentSyncRuns(take = 10) {
    return this.prisma.inventorySyncRun.findMany({ orderBy: { startedAt: 'desc' }, take });
  }

  async createBranch(dto: CreateBranchDto) {
    return this.prisma.branch.create({ data: dto });
  }

  async updateBranch(id: string, dto: UpdateBranchDto) {
    const branch = await this.prisma.branch.findUnique({ where: { id } });
    if (!branch) throw new NotFoundException(`Sucursal ${id} no encontrada`);
    return this.prisma.branch.update({ where: { id }, data: dto });
  }

  async findAllSynonyms() {
    return this.prisma.searchSynonym.findMany({ orderBy: { term: 'asc' } });
  }

  async createSynonym(dto: CreateSynonymDto) {
    return this.prisma.searchSynonym.create({
      data: { term: dto.term.trim().toLowerCase(), relatedTerms: dto.relatedTerms.map((t) => t.trim()) },
    });
  }

  async updateSynonym(id: string, dto: UpdateSynonymDto) {
    const existing = await this.prisma.searchSynonym.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Sinónimo ${id} no encontrado`);
    return this.prisma.searchSynonym.update({
      where: { id },
      data: { relatedTerms: dto.relatedTerms?.map((t) => t.trim()) },
    });
  }

  async deleteSynonym(id: string) {
    const existing = await this.prisma.searchSynonym.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Sinónimo ${id} no encontrado`);
    await this.prisma.searchSynonym.delete({ where: { id } });
  }

  /// Lista Negra: registro de referencia de que productos deben estar
  /// bloqueados en WooCommerce -- ver ProductBlacklist en el schema.
  /// NO aplica nada en WooCommerce/WordPress, es solo para que el equipo
  /// audite despues.
  async findAllBlacklistEntries() {
    return this.prisma.productBlacklist.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createBlacklistEntry(dto: CreateBlacklistEntryDto, addedByUserId?: string) {
    return this.prisma.productBlacklist.create({
      data: { sku: dto.sku.trim(), name: dto.name.trim(), reason: dto.reason.trim(), addedByUserId },
    });
  }

  async deleteBlacklistEntry(id: string) {
    const existing = await this.prisma.productBlacklist.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Entrada ${id} no encontrada en la Lista Negra`);
    await this.prisma.productBlacklist.delete({ where: { id } });
  }

  /// Expande una busqueda por categoria/sintoma (ej. "hongos") a los
  /// terminos reales que SI aparecen en el catalogo (ej. "clotrimazol",
  /// "fluconazol") -- ver SearchSynonym. Sin esto, "que tiene para
  /// hongos" solo encuentra un producto que tenga la palabra "hongos"
  /// literal en el nombre, ignorando decenas de antimicoticos reales
  /// (bug real reportado por el usuario 2026-07-28).
  async resolveSynonyms(term: string): Promise<string[]> {
    const normalized = term.toLowerCase();
    const synonyms = await this.prisma.searchSynonym.findMany();
    const matched = synonyms.filter((s) => normalized.includes(s.term));
    return [...new Set(matched.flatMap((s) => s.relatedTerms))];
  }

  /// Busqueda usada por el chatbot (ver ChatbotService) a partir del
  /// productQuery que extractChatIntent saco del mensaje del cliente.
  /// `take` bajo a proposito: el LLM que compone la respuesta no debe
  /// recibir decenas de resultados ambiguos, mejor pocos y precisos.
  /// Devuelve tambien `wasCategoryMatch` -- true si `term` calzo contra el
  /// diccionario de sinonimos (ver resolveSynonyms), osea que el cliente
  /// pregunto por una categoria/sintoma (ej. "para los pies") y no por un
  /// producto puntual. ChatbotService usa esta bandera para agregar
  /// SIEMPRE, de forma determinista, el aviso de "esto no es una
  /// formulacion medica" -- pedido explicito del usuario 2026-07-29.
  async searchProducts(term: string, take = 5) {
    const relatedTerms = await this.resolveSynonyms(term);
    const allTerms = [term, ...relatedTerms];
    const wasCategoryMatch = relatedTerms.length > 0;
    // Una busqueda por categoria/sintoma (ej. "hongos" -> Clotrimazol,
    // Fluconazol, Ketoconazol...) suele calzar con muchos productos
    // reales a la vez -- pedido explicito del usuario 2026-07-29: nunca
    // mostrar mas de 3 en ese caso, aunque una busqueda literal normal
    // siga permitiendo hasta `take`.
    const effectiveTake = wasCategoryMatch ? Math.min(take, 3) : take;

    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        hiddenFromCatalog: false,
        OR: allTerms.flatMap((t) => [
          { name: { contains: t, mode: 'insensitive' as const } },
          { sku: { contains: t, mode: 'insensitive' as const } },
          { activeIngredient: { contains: t, mode: 'insensitive' as const } },
        ]),
      },
      include: PRODUCT_WITH_STOCK_INCLUDE,
      orderBy: { name: 'asc' },
      take: effectiveTake,
    });

    return { products, wasCategoryMatch };
  }

  /// Alternativas por mismo principio activo (nunca por nombre parecido)
  /// y solo con stock real en al menos una sucursal -- sugerir algo que
  /// tampoco hay disponible no ayuda al cliente.
  async findAlternatives(productId: string, take = 5) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product?.activeIngredient) return [];

    return this.prisma.product.findMany({
      where: {
        id: { not: productId },
        isActive: true,
        hiddenFromCatalog: false,
        activeIngredient: product.activeIngredient,
        stock: { some: { quantity: { gt: 0 } } },
      },
      include: PRODUCT_WITH_STOCK_INCLUDE,
      take,
    });
  }
}
