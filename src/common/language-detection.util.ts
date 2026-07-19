/// Brief seccion 9: "Idioma" es un campo obligatorio de la tabla central
/// (ES / EN / otro) -- debe reflejar el idioma REAL del contenido
/// recuperado, no un valor fijo. Antes de este util, Article.language
/// nunca se asignaba en la ingesta y todo quedaba en el default del
/// schema ("es"), incluso para fuentes en ingles (CDC, WHO, PAHO, NIH) --
/// informacion que no correspondia a lo que realmente se recolecto.
///
/// Heuristica simple y sin dependencias (whitelist de fuentes cerrada --
/// solo hace falta distinguir ES/EN de forma confiable, no 82 idiomas):
/// cuenta marcadores exclusivos de espanol (tildes/enye/signos de
/// apertura) y stopwords de cada idioma sobre titulo+extracto/contenido.
/// Ante empate o texto sin senales claras, se conserva "es" como default
/// conservador (la mayoria de las fuentes autorizadas son colombianas).
const SPANISH_MARKERS = /[áéíóúñ¿¡]/i;

const SPANISH_STOPWORDS = new Set([
  'de', 'la', 'el', 'en', 'que', 'los', 'las', 'del', 'para', 'con', 'una', 'uno',
  'por', 'según', 'salud', 'informó', 'anunció', 'se', 'su', 'sus', 'como', 'más',
  'fue', 'ha', 'han', 'este', 'esta', 'estos', 'estas', 'al', 'un', 'sobre', 'entre',
]);

const ENGLISH_STOPWORDS = new Set([
  'the', 'and', 'of', 'to', 'in', 'for', 'with', 'that', 'from', 'on', 'health',
  'according', 'has', 'was', 'were', 'is', 'are', 'this', 'these', 'those', 'by',
  'as', 'at', 'be', 'has', 'its', 'an', 'or', 'new', 'data', 'shows',
]);

export function detectLanguage(text: string): string {
  const normalized = text.toLowerCase();
  const words = normalized.match(/[a-záéíóúñ]+/g) ?? [];
  if (words.length === 0) return 'es';

  let esScore = SPANISH_MARKERS.test(normalized) ? 3 : 0;
  let enScore = 0;
  for (const word of words) {
    if (SPANISH_STOPWORDS.has(word)) esScore++;
    if (ENGLISH_STOPWORDS.has(word)) enScore++;
  }

  if (esScore === 0 && enScore === 0) return 'es';
  return esScore >= enScore ? 'es' : 'en';
}
