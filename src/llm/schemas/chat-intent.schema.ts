import { z } from 'zod';

export const ChatIntentSchema = z.object({
  intent: z.enum(['STOCK_CHECK', 'PRICE_CHECK', 'ALTERNATIVES', 'BRANCH_INFO', 'MEDICAL_OFF_TOPIC', 'OTHER']),
  productQuery: z.string().nullable(),
  branchQuery: z.string().nullable(),
  /// true si productQuery describe una categoria/sintoma/parte del cuerpo
  /// (ej. "para los pies", "para la gripa") en vez de un producto puntual
  /// por nombre/marca (ej. "ibuprofeno 400mg"). ChatbotService usa esto
  /// para agregar SIEMPRE, de forma determinista, el aviso de "esto no es
  /// una formulacion medica" -- no se puede inferir solo de si la
  /// busqueda de texto matcheo por casualidad (ver bug real 2026-07-29:
  /// "gripa" matcheaba productos por coincidencia literal del nombre sin
  /// pasar por el diccionario de sinonimos, y se perdia el aviso).
  isCategoryQuery: z.boolean(),
});

export type ChatIntentOutput = z.infer<typeof ChatIntentSchema>;

export const CHAT_INTENT_TOOL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: ['STOCK_CHECK', 'PRICE_CHECK', 'ALTERNATIVES', 'BRANCH_INFO', 'MEDICAL_OFF_TOPIC', 'OTHER'] },
    productQuery: { type: ['string', 'null'] },
    branchQuery: { type: ['string', 'null'] },
    isCategoryQuery: { type: 'boolean' },
  },
  required: ['intent', 'productQuery', 'branchQuery', 'isCategoryQuery'],
} as const;
