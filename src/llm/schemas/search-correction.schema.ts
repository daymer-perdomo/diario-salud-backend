import { z } from 'zod';

export const SearchCorrectionSchema = z.object({
  /// Terminos alternativos a intentar cuando la busqueda literal no
  /// encontro nada -- sinonimos reales de farmacia/Colombia, nombre
  /// generico vs. de marca, correccion de ortografia, singular/plural.
  /// NUNCA nombres de marca especificos inventados, solo terminos de
  /// busqueda razonables (ver ChatbotService.gatherFacts).
  alternativeTerms: z.array(z.string()).max(5),
});

export type SearchCorrectionOutput = z.infer<typeof SearchCorrectionSchema>;

export const SEARCH_CORRECTION_TOOL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    alternativeTerms: { type: 'array', items: { type: 'string' }, maxItems: 5 },
  },
  required: ['alternativeTerms'],
} as const;
