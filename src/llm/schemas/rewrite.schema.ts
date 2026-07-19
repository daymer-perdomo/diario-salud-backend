import { z } from 'zod';

/// Cada claim debe apuntar a un fragmento textual del original que la
/// respalda. Un supportingSpanInOriginal=null es en si mismo una senal
/// sospechosa que GroundingModule trata como fallo (ver
/// grounding-verifier.service.ts).
export const ClaimSchema = z.object({
  text: z.string().min(1),
  type: z.enum(['NUMBER', 'DATE', 'ENTITY', 'STATEMENT']),
  supportingSpanInOriginal: z.string().nullable(),
});

export const RewriteOutputSchema = z.object({
  rewrittenTitle: z.string().min(1).max(200),
  rewrittenSummary: z.string().min(1).max(500),
  rewrittenContent: z.string().min(1),
  /// Brief seccion 11 ("Puntos clave"): 2-5 frases breves, cada una debe
  /// poder respaldarse igual que el cuerpo -- GroundingModule las trata
  /// como texto reescrito mas para efectos de verificacion de claims.
  keyPoints: z.array(z.string().min(1)).min(1).max(5),
  /// Brief seccion 11 ("Por que es importante"): bloque contextual breve,
  /// mismas reglas de la seccion 7 (nunca recomendar/diagnosticar/etc).
  whyItMatters: z.string().min(1).max(600),
  claims: z.array(ClaimSchema),
});

export type Claim = z.infer<typeof ClaimSchema>;
export type RewriteOutput = z.infer<typeof RewriteOutputSchema>;

export const REWRITE_TOOL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    rewrittenTitle: { type: 'string' },
    rewrittenSummary: { type: 'string' },
    rewrittenContent: { type: 'string' },
    keyPoints: { type: 'array', items: { type: 'string' } },
    whyItMatters: { type: 'string' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          type: { type: 'string', enum: ['NUMBER', 'DATE', 'ENTITY', 'STATEMENT'] },
          supportingSpanInOriginal: { type: ['string', 'null'] },
        },
        required: ['text', 'type', 'supportingSpanInOriginal'],
      },
    },
  },
  required: ['rewrittenTitle', 'rewrittenSummary', 'rewrittenContent', 'keyPoints', 'whyItMatters', 'claims'],
} as const;
