import { z } from 'zod';

/// Capa 2b de grounding: extraccion adversarial e independiente de
/// claims a partir del texto YA reescrito, sin depender de la lista
/// "claims" que el propio modelo de rewrite decidio autoreportar (ver
/// comentario en GroundingProcessor sobre por que un rewrite deshonesto
/// o perezoso podia devolver claims=[] y saltarse toda la verificacion
/// de capa 2 para texto no numerico).
export const ExtractedClaimSchema = z.object({
  text: z.string().min(1),
  type: z.enum(['NUMBER', 'DATE', 'ENTITY', 'STATEMENT']),
});

export const ExtractClaimsOutputSchema = z.object({
  claims: z.array(ExtractedClaimSchema),
});

export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;
export type ExtractClaimsOutput = z.infer<typeof ExtractClaimsOutputSchema>;

export const EXTRACT_CLAIMS_TOOL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['NUMBER', 'DATE', 'ENTITY', 'STATEMENT'] },
        },
        required: ['text', 'type'],
      },
    },
  },
  required: ['claims'],
} as const;
