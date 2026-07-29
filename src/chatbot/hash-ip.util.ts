import { createHash } from 'crypto';

/// Nunca se guarda la IP cruda (ver ChatSession.ipHash) -- solo se
/// necesita agrupar mensajes del mismo origen para rate limiting, no
/// identificar a la persona. Sin salt: no es un secreto que proteger,
/// solo evita guardar la IP en texto plano en la base de datos.
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}
