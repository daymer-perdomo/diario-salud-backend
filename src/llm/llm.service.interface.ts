import { RewriteOutput } from './schemas/rewrite.schema';
import { VerifyClaimsOutput } from './schemas/verify-claims.schema';
import { ComplianceCheckOutput } from './schemas/compliance.schema';
import { ScoringOutput } from './schemas/scoring.schema';
import { ExtractClaimsOutput } from './schemas/extract-claims.schema';
import { ChatIntentOutput } from './schemas/chat-intent.schema';
import { ChatReplyOutput } from './schemas/chat-reply.schema';

/// Interfaz intercambiable: el proveedor de IA (Claude, OpenAI, u otro)
/// se decide en LlmModule, no aqui. Ningun modulo del pipeline debe
/// importar el SDK de un proveedor concreto directamente.
export interface LlmService {
  scoreRelevanceAndRisk(input: {
    originalTitle: string;
    originalContent: string;
    sourceInstitution: string;
  }): Promise<ScoringOutput>;

  rewrite(input: { originalTitle: string; originalContent: string; sourceInstitution: string }): Promise<RewriteOutput>;

  /// Verificacion ADVERSARIAL e independiente: debe llamarse con un
  /// system prompt distinto al de rewrite() y sin decirle al modelo que
  /// el texto es una "reescritura propia" -- ver GeminiLlmService.
  verifyClaims(input: {
    originalContent: string;
    claims: Array<{ text: string; type: string; supportingSpanInOriginal: string | null }>;
  }): Promise<VerifyClaimsOutput>;

  /// Segunda opinion ADVERSARIAL sobre que claims existen -- redescubre
  /// los claims desde el texto reescrito sin depender de la lista que el
  /// propio rewrite() autoreporto (ver comentario en GroundingProcessor:
  /// un rewrite que devuelve claims=[] no debe poder saltarse la
  /// verificacion de contenido no numerico).
  extractClaims(input: { rewrittenText: string }): Promise<ExtractClaimsOutput>;

  checkCompliance(input: { rewrittenTitle: string; rewrittenContent: string }): Promise<ComplianceCheckOutput>;

  extractChatIntent(input: {
    message: string;
    history: Array<{ role: 'USER' | 'ASSISTANT'; content: string }>;
  }): Promise<ChatIntentOutput>;

  composeChatReply(input: { message: string; facts: unknown }): Promise<ChatReplyOutput>;
}

export const LLM_SERVICE = 'LLM_SERVICE';
