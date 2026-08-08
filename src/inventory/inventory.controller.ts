import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { InventoryService } from './inventory.service';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpsertStockDto } from './dto/upsert-stock.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { CreateSynonymDto } from './dto/create-synonym.dto';
import { UpdateSynonymDto } from './dto/update-synonym.dto';
import { CreateBlacklistEntryDto } from './dto/create-blacklist-entry.dto';
import { CreateProductDto } from './dto/create-product.dto';
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
@ApiTags('Inventario')
@ApiBearerAuth('jwt')
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
  @ApiOperation({ summary: 'Buscar/listar productos (paginado)' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAllProducts(@Query() query: QueryProductsDto) {
    return this.inventoryService.findAllProducts(query);
  }

  @Get('products/:id')
  @ApiOperation({ summary: 'Detalle de un producto (con stock por sucursal)' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findOneProduct(@Param('id') id: string) {
    return this.inventoryService.findOneProduct(id);
  }

  @Post('products')
  @ApiOperation({ summary: 'Crear un producto a mano (entre importaciones de Excel/Distrimonaco)' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  createProduct(@Body() dto: CreateProductDto) {
    return this.inventoryService.createProduct(dto);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Editar campos manuales de un producto' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.inventoryService.updateProduct(id, dto);
  }

  @Patch('products/:id/stock/:branchId')
  @ApiOperation({ summary: 'Fijar cantidad/precio de un producto en una sucursal' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'branchId' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  upsertStock(@Param('id') id: string, @Param('branchId') branchId: string, @Body() dto: UpsertStockDto) {
    return this.inventoryService.upsertStock(id, branchId, dto);
  }

  @Get('branches')
  @ApiOperation({ summary: 'Listar sucursales' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAllBranches() {
    return this.inventoryService.findAllBranches();
  }

  @Post('branches')
  @ApiOperation({ summary: 'Crear una sucursal' })
  @Roles(UserRole.ADMIN)
  createBranch(@Body() dto: CreateBranchDto) {
    return this.inventoryService.createBranch(dto);
  }

  @Patch('branches/:id')
  @ApiOperation({ summary: 'Editar una sucursal' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN)
  updateBranch(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.inventoryService.updateBranch(id, dto);
  }

  /// Dispara la sincronizacion con Distrimonaco de inmediato en vez de
  /// esperar al intervalo programado (ver DistrimonacoSyncService) --
  /// mismo espiritu que "Consultar fuentes ahora" en Sources.
  @Post('sync-now')
  @ApiOperation({ summary: 'Sincronizar inventario con Distrimonaco ahora' })
  @Roles(UserRole.ADMIN)
  syncNow() {
    return this.distrimonacoSync.syncNow();
  }

  /// Dispara el backfill de imagenes contra WooCommerce de inmediato en
  /// vez de esperar al intervalo programado (ver
  /// WoocommerceImageSyncService) -- mismo espiritu que POST /sync-now.
  @Post('sync-images-now')
  @ApiOperation({ summary: 'Backfill de imagenes de producto desde WooCommerce ahora' })
  @Roles(UserRole.ADMIN)
  syncImagesNow() {
    return this.woocommerceImageSync.syncNow();
  }

  @Get('sync-runs')
  @ApiOperation({ summary: 'Historial de corridas de sincronizacion de inventario' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findRecentSyncRuns() {
    return this.inventoryService.findRecentSyncRuns();
  }

  /// Diccionario de categoria/sintoma -> terminos reales de producto que
  /// usa InventoryService.searchProducts (ver ese archivo para el porque:
  /// "que tiene para hongos" no encontraba los antimicoticos reales).
  @Get('synonyms')
  @ApiOperation({ summary: 'Listar diccionario de sinonimos de busqueda' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAllSynonyms() {
    return this.inventoryService.findAllSynonyms();
  }

  @Post('synonyms')
  @ApiOperation({ summary: 'Agregar un sinonimo de busqueda' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  createSynonym(@Body() dto: CreateSynonymDto) {
    return this.inventoryService.createSynonym(dto);
  }

  @Patch('synonyms/:id')
  @ApiOperation({ summary: 'Editar un sinonimo de busqueda' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  updateSynonym(@Param('id') id: string, @Body() dto: UpdateSynonymDto) {
    return this.inventoryService.updateSynonym(id, dto);
  }

  @Delete('synonyms/:id')
  @ApiOperation({ summary: 'Eliminar un sinonimo de busqueda' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  async deleteSynonym(@Param('id') id: string) {
    await this.inventoryService.deleteSynonym(id);
    return { deleted: true };
  }

  /// Lista Negra: registro de referencia de productos que deben estar
  /// bloqueados en la tienda WooCommerce (ver ProductBlacklist en el
  /// schema y docs/integracion-inventario-wordpress.md seccion 0). NO
  /// aplica nada en WordPress -- el bloqueo real se hace a mano en
  /// wp-admin, esto es solo para que el equipo audite despues.
  @Get('blacklist')
  @ApiOperation({ summary: 'Listar la Lista Negra de productos' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  findAllBlacklistEntries() {
    return this.inventoryService.findAllBlacklistEntries();
  }

  @Post('blacklist')
  @ApiOperation({ summary: 'Agregar un producto a la Lista Negra' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  createBlacklistEntry(@Body() dto: CreateBlacklistEntryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventoryService.createBlacklistEntry(dto, user.userId);
  }

  @Delete('blacklist/:id')
  @ApiOperation({ summary: 'Quitar un producto de la Lista Negra' })
  @ApiParam({ name: 'id' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  async deleteBlacklistEntry(@Param('id') id: string) {
    await this.inventoryService.deleteBlacklistEntry(id);
    return { deleted: true };
  }

  /// Busca en la COPIA LOCAL del catalogo de WooCommerce (~42,300 productos)
  /// que sube el plugin de WordPress -- ya no es una busqueda en vivo:
  /// Cloudflare bloquea con 403 el trafico entrante desde Render, ver
  /// WoocommerceCatalogService.
  @Get('woocommerce/products')
  @ApiOperation({ summary: 'Buscar en la copia local del catalogo de WooCommerce' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  searchWoocommerceProducts(@Query() query: SearchWoocommerceProductsDto) {
    return this.woocommerceCatalog.searchProducts(query.q);
  }

  /// Lo que WordPress reporto como agotado/oculto en su ultima corrida
  /// (ver docs/wpcode-inventario-disponibilidad-reporte.php) -- estado
  /// REAL en WooCommerce segun el ultimo reporte, sin importar desde
  /// donde se haya marcado.
  @Get('woocommerce/unavailable')
  @ApiOperation({ summary: 'Listar lo que WordPress reporto como agotado/oculto' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  listUnavailableWoocommerceProducts() {
    return this.woocommerceCatalog.listUnavailableProducts();
  }

  /// Lista lo marcado "no disponible" desde este dashboard -- WooCommerce
  /// no permite filtrar por catalog_visibility via su API, asi que esto
  /// lee de la tabla local que llevamos nosotros (ver
  /// WoocommerceCatalogService.setAvailability).
  @Get('woocommerce/hidden-products')
  @ApiOperation({ summary: 'Listar productos marcados como no disponibles' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR, UserRole.VALIDATOR, UserRole.VIEWER)
  listHiddenWoocommerceProducts() {
    return this.woocommerceCatalog.listHiddenProducts();
  }

  /// Encola "marcar/desmarcar como no disponible" (catalog_visibility=hidden)
  /// -- independiente del stock real. NO se aplica al instante: lo aplica el
  /// plugin de WordPress en su proxima corrida, ver WoocommerceCatalogService.
  /// La respuesta trae pendingHidden para que el dashboard lo muestre.
  @Patch('woocommerce/products/:id/availability')
  @ApiOperation({
    summary: 'Marcar/desmarcar un producto como no disponible',
    description: 'Se encola -- lo aplica el plugin de WordPress en su proxima corrida, no es instantaneo.',
  })
  @ApiParam({ name: 'id', description: 'ID numerico del producto en WooCommerce' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  setWoocommerceAvailability(
    @Param('id') id: string,
    @Body() dto: SetWoocommerceAvailabilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.woocommerceCatalog.setAvailability(Number(id), dto.hidden, user.userId);
  }

  /// Independiente del anterior -- apunta a stock_status (agotado/con stock)
  /// en vez de catalog_visibility. Tambien se encola, ver el anterior.
  @Patch('woocommerce/products/:id/stock-status')
  @ApiOperation({
    summary: 'Marcar/desmarcar un producto como agotado',
    description: 'Se encola -- lo aplica el plugin de WordPress en su proxima corrida, no es instantaneo.',
  })
  @ApiParam({ name: 'id', description: 'ID numerico del producto en WooCommerce' })
  @Roles(UserRole.ADMIN, UserRole.EDITOR)
  setWoocommerceStockStatus(
    @Param('id') id: string,
    @Body() dto: SetWoocommerceStockStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.woocommerceCatalog.setStockStatus(Number(id), dto.outOfStock, user.userId);
  }
}
