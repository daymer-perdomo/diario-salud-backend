import { z } from 'zod';

export const ScoringOutputSchema = z.object({
  isRelevant: z.boolean(),
  relevanceScore: z.number().min(0).max(1),
  relevanceReason: z.string(),
  riskLevel: z.enum(['BAJO', 'MEDIO', 'ALTO']).nullable(),
  riskReason: z.string(),
  /// Brief seccion 12: dimension de taxonomia independiente del riesgo
  /// (type-alerta / type-prevencion / type-vigilancia).
  contentType: z.enum(['ALERTA', 'PREVENCION', 'VIGILANCIA']).nullable(),
});

export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;

export const SCORING_TOOL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    isRelevant: { type: 'boolean' },
    relevanceScore: { type: 'number' },
    relevanceReason: { type: 'string' },
    riskLevel: { type: ['string', 'null'], enum: ['BAJO', 'MEDIO', 'ALTO', null] },
    riskReason: { type: 'string' },
    contentType: { type: ['string', 'null'], enum: ['ALERTA', 'PREVENCION', 'VIGILANCIA', null] },
  },
  required: ['isRelevant', 'relevanceScore', 'relevanceReason', 'riskLevel', 'riskReason', 'contentType'],
} as const;
