import { timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/// Guarda la API publica de solo lectura (GET /articles) -- pensada para un
/// consumidor externo sin cuenta de usuario, por eso usa una clave estatica
/// en vez del JwtAuthGuard/RolesGuard que protege el resto del panel.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided: string | undefined = request.headers['x-api-key'];
    const expected = this.config.get<string>('PUBLIC_API_KEY')!;

    if (!provided || !this.safeEqual(provided, expected)) {
      throw new UnauthorizedException('X-API-Key invalida o ausente');
    }
    return true;
  }

  /// Comparacion en tiempo constante para no filtrar la clave por timing.
  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
