import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT = 'ecofarma-ai-settings-v1';

/// Deriva la clave simetrica de JWT_SECRET (ya obligatorio, ya en Render)
/// en vez de pedir una variable de entorno nueva solo para esto -- unica
/// contrapartida aceptada: rotar JWT_SECRET invalida cualquier secreto ya
/// cifrado con la clave anterior (habria que volver a introducirlo desde
/// el panel). Mientras tanto, el fallback a la variable de entorno propia
/// del secreto (ver AiSettingsService.resolveEffective) sigue funcionando.
function deriveKey(jwtSecret: string): Buffer {
  return scryptSync(jwtSecret, SALT, 32);
}

/// Formato guardado: iv.authTag.ciphertext, todo en base64url, separado
/// por puntos -- sin dependencias nuevas, solo el modulo `crypto` nativo.
export function encryptSecret(plainText: string, jwtSecret: string): string {
  const key = deriveKey(jwtSecret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(stored: string, jwtSecret: string): string {
  const [ivB64, authTagB64, ciphertextB64] = stored.split('.');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Formato de secreto cifrado invalido -- se esperaban 3 segmentos separados por punto');
  }
  const key = deriveKey(jwtSecret);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64url'));
  const plainText = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64url')),
    decipher.final(),
  ]);
  return plainText.toString('utf8');
}
