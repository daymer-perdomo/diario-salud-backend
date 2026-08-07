import { timingSafeEqual } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/// Guarda la API de integracion que consume el plugin de WordPress. Misma
/// idea que ApiKeyGuard (clave estatica, no JWT, porque del otro lado no hay
/// un usuario con cuenta) pero con clave propia: estos endpoints escriben
/// (confirman cambios aplicados, reemplazan el catalogo) y la clave vive en
/// un sitio de terceros, asi que tiene que poder rotarse sin tocar la API
/// publica de articulos.
///
/// Si INTEGRATION_API_KEY no esta configurada responde 503 en vez de 401: no
/// es que la clave enviada este mal, es que la integracion no esta habilitada
/// todavia -- distinguirlo evita que el desarrollador de WordPress pierda
/// tiempo revisando su clave.
@Injectable()
export class IntegrationApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('INTEGRATION_API_KEY');
    if (!expected) {
      throw new ServiceUnavailableException(
        'La API de integracion no esta habilitada (falta INTEGRATION_API_KEY)',
      );
    }

    const request = context.switchToHttp().getRequest();
    const provided: string | undefined = request.headers['x-api-key'];

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
