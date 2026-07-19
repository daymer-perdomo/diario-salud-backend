/// Pre-filtro barato (sin IA) para los casos obvios de exclusion del
/// brief (seccion 6): ofertas de empleo y licitaciones/contratacion
/// publica. Descartar estos aqui evita gastar una llamada de IA en algo
/// que un regex ya detecta con confianza razonable. Todo lo demas (temas
/// politicos sin pertinencia, contenido de escaso valor, etc.) requiere
/// criterio editorial y se deja a ScoringModule (IA).
const JOB_POSTING_OR_PROCUREMENT_PATTERN =
  /\b(oferta(s)? de empleo|convocatoria laboral|vacante(s)?|proceso de contratacion|licitaci[oó]n|invitaci[oó]n p[uú]blica|manifestaci[oó]n de inter[eé]s|contrataci[oó]n directa)\b/i;

export function isObviousJobPostingOrProcurement(title: string, content: string): boolean {
  return JOB_POSTING_OR_PROCUREMENT_PATTERN.test(`${title}\n${content}`);
}

/// Encontrado 2026-07-16 revisando articulos ya en la DB: 26 articulos
/// reales (24 INVIMA con PDF que fallo al descargar, 2 CDC con RSS sin
/// descripcion) tienen originalContent identico a originalTitle -- HTML_SCRAPE
/// solo llena rawText con texto real si el enlace es un PDF que se pudo
/// descargar (ver HtmlScraperAdapter.enrichWithDocumentText); si no, o si
/// falla, rawText se queda igual al title para siempre. Cada uno de esos
/// igual se encolo a Scoring (1 llamada de IA) sin tener nada que evaluar
/// mas alla del titulo. Este filtro los descarta ANTES de esa llamada --
/// no hay forma de que Scoring o Rewrite produzcan algo mejor que "el
/// titulo otra vez" sin texto fuente real.
const MIN_CONTENT_LENGTH = 80;

export function hasInsufficientContent(title: string, content: string): boolean {
  const trimmedContent = content.trim();
  if (trimmedContent.length < MIN_CONTENT_LENGTH) return true;
  return trimmedContent === title.trim();
}
