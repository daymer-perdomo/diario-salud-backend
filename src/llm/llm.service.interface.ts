import { RewriteOutput } from './schemas/rewrite.schema';
import { VerifyClaimsOutput } from './schemas/verify-claims.schema';
import { ComplianceCheckOutput } from './schemas/compliance.schema';
import { ScoringOutput } from './schemas/scoring.schema';

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
  /// el texto es una "reescritura propia" -- ver ClaudeLlmService.
  verifyClaims(input: {
    originalContent: string;
    claims: Array<{ text: string; type: string; supportingSpanInOriginal: string | null }>;
  }): Promise<VerifyClaimsOutput>;

  checkCompliance(input: { rewrittenTitle: string; rewrittenContent: string }): Promise<ComplianceCheckOutput>;
}

export const LLM_SERVICE = 'LLM_SERVICE';
