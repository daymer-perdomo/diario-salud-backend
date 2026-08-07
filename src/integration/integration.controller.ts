import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IntegrationApiKeyGuard } from './guards/integration-api-key.guard';
import { IntegrationService } from './integration.service';
import { AckPendingChangesDto } from './dto/ack-pending-changes.dto';
import { UploadCatalogDto } from './dto/upload-catalog.dto';

/// API que consume el plugin de WordPress de ecofarma.co. Autenticada con
/// X-API-Key (INTEGRATION_API_KEY), no con JWT: del otro lado no hay un
/// usuario con cuenta, es un sitio hablando con otro.
///
/// El sentido de la conexion es SIEMPRE WordPress -> backend porque
/// Cloudflare responde 403 al trafico entrante desde las IPs de Render (ver
/// WoocommerceCatalogService). Los tres endpoints cubren el ciclo completo:
///   1. el plugin sube su catalogo  -> POST woocommerce/catalog
///   2. el plugin pide que cambiar   -> GET  woocommerce/pending-changes
///   3. el plugin confirma resultado -> POST woocommerce/pending-changes/ack
@ApiTags('Integracion WordPress (plugin)')
@ApiSecurity('integration-api-key')
@ApiResponse({ status: 503, description: 'INTEGRATION_API_KEY no configurada en el backend.' })
@UseGuards(IntegrationApiKeyGuard)
@Controller('integration')
export class IntegrationController {
  constructor(private readonly integration: IntegrationService) {}

  /// Cada cambio ya trae armado el `payload` exacto para
  /// PUT wp-json/wc/v3/products/{productId} -- el plugin no decide nada, solo
  /// reenvia y confirma.
  @Get('woocommerce/pending-changes')
  @ApiOperation({ summary: 'Listar cambios de catalogo pendientes de aplicar en WooCommerce' })
  async pendingChanges() {
    const changes = await this.integration.listPendingChanges();
    return { count: changes.length, changes };
  }

  @Post('woocommerce/pending-changes/ack')
  @ApiOperation({ summary: 'Confirmar el resultado (exito/error) de cada cambio aplicado' })
  ackPendingChanges(@Body() dto: AckPendingChangesDto) {
    return this.integration.ackPendingChanges(dto.results);
  }

  /// Una tanda (hasta 500) del catalogo de WooCommerce. El plugin lo sube
  /// por paginas: son ~42,300 productos.
  @Post('woocommerce/catalog')
  @ApiOperation({ summary: 'Subir una tanda (hasta 500) del catalogo de WooCommerce' })
  uploadCatalog(@Body() dto: UploadCatalogDto) {
    return this.integration.uploadCatalog(dto.items);
  }
}
