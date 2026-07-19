import { Article } from '@prisma/client';

/// Todo el texto que la IA reescribio y que por lo tanto puede contener
/// afirmaciones factuales o violaciones de la seccion 7.2 del brief --
/// no solo rewrittenContent. Usado por ComplianceProcessor (regex + IA)
/// y GroundingProcessor (diff numerico deterministico) para que
/// "Puntos clave" y "Por que es importante" (brief seccion 11) queden
/// bajo la misma verificacion que el cuerpo principal, en vez de ser una
/// superficie sin chequear.
export function getRewrittenBodyText(
  article: Pick<Article, 'rewrittenContent' | 'rewrittenKeyPoints' | 'rewrittenWhyItMatters'>,
): string {
  return [article.rewrittenContent ?? '', ...(article.rewrittenKeyPoints ?? []), article.rewrittenWhyItMatters ?? '']
    .filter(Boolean)
    .join('\n');
}
