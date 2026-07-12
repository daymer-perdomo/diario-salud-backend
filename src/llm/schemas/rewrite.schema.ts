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
  required: ['rewrittenTitle', 'rewrittenSummary', 'rewrittenContent', 'claims'],
} as const;
