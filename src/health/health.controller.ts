import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

/// Endpoint publico (sin guard) que consume el dashboard para mostrar el
/// indicador de conexion -- analogo al /health de CentraVigia.
@ApiTags('Salud del sistema (publico)')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Estado del backend y conectividad a la base de datos' })
  async check() {
    let database: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
