import { z } from 'zod';

export const ChatReplyOutputSchema = z.object({
  reply: z.string(),
});

export type ChatReplyOutput = z.infer<typeof ChatReplyOutputSchema>;

export const CHAT_REPLY_TOOL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
  },
  required: ['reply'],
} as const;
