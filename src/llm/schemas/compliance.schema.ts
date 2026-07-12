import { z } from 'zod';

export const ComplianceViolationSchema = z.object({
  rule: z.string(),
  excerpt: z.string(),
  explanation: z.string(),
});

export const ComplianceCheckOutputSchema = z.object({
  passes: z.boolean(),
  violations: z.array(ComplianceViolationSchema),
});

export type ComplianceViolation = z.infer<typeof ComplianceViolationSchema>;
export type ComplianceCheckOutput = z.infer<typeof ComplianceCheckOutputSchema>;

export const COMPLIANCE_TOOL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    passes: { type: 'boolean' },
    violations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          excerpt: { type: 'string' },
          explanation: { type: 'string' },
        },
        required: ['rule', 'excerpt', 'explanation'],
      },
    },
  },
  required: ['passes', 'violations'],
} as const;
