/// Capa 3 del chequeo de grounding: sin IA, determinista. Extrae numeros,
/// porcentajes y fechas del texto reescrito y los compara contra el
/// original -- cualquier valor numerico en el reescrito que no aparezca
/// (ni siquiera con formato distinto) en el original se marca como no
/// respaldado. Esto atrapa el caso en que el modelo "miente sobre su
/// propia cita" (dice que un numero viene del original cuando no es
/// asi), algo que la verificacion adversarial (capa 2) por si sola no
/// puede detectar si el modelo verificador tambien se equivoca en el
/// mismo numero.
// Solo se incluye "." o "," como parte del numero si va seguido de mas
// digitos (separador de miles/decimales real). Un numero seguido de
// puntuacion de cierre de frase (ej. "123." al final de una oracion) NO
// debe capturar ese punto -- de lo contrario "123," en el original y
// "123." en el reescrito (mismo numero, distinta puntuacion circundante)
// se normalizan distinto y generan un falso mismatch.
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*\s?%?/g;

export interface UngroundedNumeric {
  value: string;
  context: string;
}

function extractNumbers(text: string): string[] {
  return (text.match(NUMBER_PATTERN) ?? []).map((n) => normalizeNumber(n));
}

function normalizeNumber(raw: string): string {
  return raw.replace(/\s/g, '').replace(/[.,](?=\d{3}\b)/g, '');
}

export function findUngroundedNumerics(originalText: string, rewrittenText: string): UngroundedNumeric[] {
  const originalNumbers = new Set(extractNumbers(originalText));
  const rewrittenNumberMatches = rewrittenText.match(NUMBER_PATTERN) ?? [];

  const ungrounded: UngroundedNumeric[] = [];
  for (const match of rewrittenNumberMatches) {
    const normalized = normalizeNumber(match);
    // Se ignoran numeros triviales (anios de 4 cifras cercanos al actual
    // suelen aparecer por fecha de publicacion, no por un dato citado;
    // igual se listan si no coinciden, pero sin bloquear por si solos
    // sub-1 o numeros de un digito que suelen ser enumeraciones "1.", "2.").
    if (normalized.length <= 1) continue;
    if (!originalNumbers.has(normalized)) {
      const idx = rewrittenText.indexOf(match);
      const context = rewrittenText.slice(Math.max(0, idx - 40), idx + match.length + 40);
      ungrounded.push({ value: match, context });
    }
  }
  return ungrounded;
}
