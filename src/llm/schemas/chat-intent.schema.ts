import { z } from 'zod';

export const ChatIntentSchema = z.object({
  intent: z.enum(['STOCK_CHECK', 'PRICE_CHECK', 'ALTERNATIVES', 'BRANCH_INFO', 'MEDICAL_OFF_TOPIC', 'OTHER']),
  productQuery: z.string().nullable(),
  branchQuery: z.string().nullable(),
});

export type ChatIntentOutput = z.infer<typeof ChatIntentSchema>;

export const CHAT_INTENT_TOOL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['STOCK_CHECK', 'PRICE_CHECK', 'ALTERNATIVES', 'BRANCH_INFO', 'MEDICAL_OFF_TOPIC', 'OTHER'] },
    productQuery: { type: ['string', 'null'] },
    branchQuery: { type: ['string', 'null'] },
  },
  required: ['intent', 'productQuery', 'branchQuery'],
} as const;
