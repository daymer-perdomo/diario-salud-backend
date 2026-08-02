import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { InventoryService } from './inventory.service';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpsertStockDto } from './dto/upsert-stock.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { CreateSynonymDto } from './dto/create-synonym.dto';
import { UpdateSynonymDto } from './dto/update-synonym.dto';
import { DistrimonacoSyncService } from './distrimonaco-sync.service';
import { WoocommerceImageSyncService } from './woocommerce-image-sync.service';
import { WoocommerceCatalogService } from './woocommerce-catalog.service';
import { SearchWoocommerceProductsDto } from './dto/search-woocommerce-products.dto';
import { SetWoocommerceAvailabilityDto } from './dto/set-woocommerce-availability.dto';
import { SetWoocommerceStockStatusDto } from './dto/set-woocommerce-stock-status.dto';

/// Panel admin de mantenimiento manual de inventario entre importaciones
/// masivas de Excel (ver scripts/import-inventory-master.ts) -- mismo
/// esquema de permisos que BlogController: lectura abierta a los 4 roles,
/// escritura solo ADMIN/EDITOR. Este controller NUNCA es el que consume
/// el chatbot publico (ese usa InventoryService directo via DI, ver
/// ChatbotService) -- todo lo de aca exige login.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly distrimonacoSync: DistrimonacoSyncService,
    private readonly woocommerceImageSync: WoocommerceImageSyncService,
    private readonly woocommerceCatalog: WoocommerceCatalogService,
  ) {}

  @Get('products')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAllProducts(@Query() query: QueryProductsDto) {
    return this.inventoryService.findAllProducts(query);
  }

  @Get('products/:id')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findOneProduct(@Param('id') id: string) {
    return this.inventoryService.findOneProduct(id);
  }

  @Patch('products/:id')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.inventoryService.updateProduct(id, dto);
  }

  @Patch('products/:id/stock/:branchId')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  upsertStock(@Param('id') id: string, @Param('branchId') branchId: string, @Body() dto: UpsertStockDto) {
    return this.inventoryService.upsertStock(id, branchId, dto);
  }

  @Get('branches')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAllBranches() {
    return this.inventoryService.findAllBranches();
  }

  @Post('branches')
  @Roles(UserRole.ADMIN)
  createBranch(@Body() dto: CreateBranchDto) {
    return this.inventoryService.createBranch(dto);
  }

  @Patch('branches/:id')
  @Roles(UserRole.ADMIN)
  updateBranch(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.inventoryService.updateBranch(id, dto);
  }

  /// Dispara la sincronizacion con Distrimonaco de inmediato en vez de
  /// esperar al intervalo programado (ver DistrimonacoSyncService) --
  /// mismo espiritu que "Consultar fuentes ahora" en Sources.
  @Post('sync-now')
  @Roles(UserRole.ADMIN)
  syncNow() {
    return this.distrimonacoSync.syncNow();
  }

  /// Dispara el backfill de imagenes contra WooCommerce de inmediato en
  /// vez de esperar al intervalo programado (ver
  /// WoocommerceImageSyncService) -- mismo espiritu que POST /sync-now.
  @Post('sync-images-now')
  @Roles(UserRole.ADMIN)
  syncImagesNow() {
    return this.woocommerceImageSync.syncNow();
  }

  @Get('sync-runs')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findRecentSyncRuns() {
    return this.inventoryService.findRecentSyncRuns();
  }

  /// Diccionario de categoria/sintoma -> terminos reales de producto que
  /// usa InventoryService.searchProducts (ver ese archivo para el porque:
  /// "que tiene para hongos" no encontraba los antimicoticos reales).
  @Get('synonyms')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAllSynonyms() {
    return this.inventoryService.findAllSynonyms();
  }

  @Post('synonyms')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  createSynonym(@Body() dto: CreateSynonymDto) {
    return this.inventoryService.createSynonym(dto);
  }

  @Patch('synonyms/:id')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updateSynonym(@Param('id') id: string, @Body() dto: UpdateSynonymDto) {
    return this.inventoryService.updateSynonym(id, dto);
  }

  @Delete('synonyms/:id')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  async deleteSynonym(@Param('id') id: string) {
    await this.inventoryService.deleteSynonym(id);
    return { deleted: true };
  }

  /// Busqueda EN VIVO contra el catalogo real de WooCommerce (~42,300
  /// productos, ver WoocommerceCatalogService) -- no hay copia local, asi
  /// que esto siempre pega contra la API externa.
  @Get('woocommerce/products')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  searchWoocommerceProducts(@Query() query: SearchWoocommerceProductsDto) {
    return this.woocommerceCatalog.searchProducts(query.q);
  }

  /// Lista lo marcado "no disponible" desde este dashboard -- WooCommerce
  /// no permite filtrar por catalog_visibility via su API, asi que esto
  /// lee de la tabla local que llevamos nosotros (ver
  /// WoocommerceCatalogService.setAvailability).
  @Get('woocommerce/hidden-products')
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  listHiddenWoocommerceProducts() {
    return this.woocommerceCatalog.listHiddenProducts();
  }

  /// Marca/desmarca un producto de WooCommerce como "no disponible"
  /// (catalog_visibility=hidden) -- independiente del stock real, ver
  /// WoocommerceCatalogService.
  @Patch('woocommerce/products/:id/availability')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  setWoocommerceAvailability(@Param('id') id: string, @Body() dto: SetWoocommerceAvailabilityDto) {
    return this.woocommerceCatalog.setAvailability(Number(id), dto.hidden);
  }

  /// Independiente del anterior -- pisa stock_status (agotado/con stock)
  /// en vez de catalog_visibility, ver WoocommerceCatalogService.
  @Patch('woocommerce/products/:id/stock-status')
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  setWoocommerceStockStatus(@Param('id') id: string, @Body() dto: SetWoocommerceStockStatusDto) {
    return this.woocommerceCatalog.setStockStatus(Number(id), dto.outOfStock);
  }
}
