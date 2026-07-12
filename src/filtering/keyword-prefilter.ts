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
