import { z } from 'zod';

export const ClaimVerdictSchema = z.object({
  claimText: z.string(),
  verdict: z.enum(['SOPORTADA', 'PARCIAL', 'NO_SOPORTADA']),
  evidenceQuote: z.string().nullable(),
  explanation: z.string(),
});

export const VerifyClaimsOutputSchema = z.object({
  verdicts: z.array(ClaimVerdictSchema),
});

export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;
export type VerifyClaimsOutput = z.infer<typeof VerifyClaimsOutputSchema>;

export const VERIFY_CLAIMS_TOOL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claimText: { type: 'string' },
          verdict: { type: 'string', enum: ['SOPORTADA', 'PARCIAL', 'NO_SOPORTADA'] },
          evidenceQuote: { type: ['string', 'null'] },
          explanation: { type: 'string' },
        },
        required: ['claimText', 'verdict', 'evidenceQuote', 'explanation'],
      },
    },
  },
  required: ['verdicts'],
} as const;
