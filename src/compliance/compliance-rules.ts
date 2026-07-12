/// Capa determinista (sin IA) de deteccion de violaciones obvias segun
/// el brief seccion 7.2. Corre EN PARALELO con el chequeo semantico de
/// IA (ver compliance.processor.ts) -- cualquiera de las dos que
/// encuentre una violacion basta para RECHAZAR.
export interface RegexRuleViolation {
  rule: string;
  excerpt: string;
  explanation: string;
}

interface ComplianceRule {
  rule: string;
  pattern: RegExp;
  explanation: string;
}

const RULES: ComplianceRule[] = [
  {
    rule: 'DOSIFICACION',
    pattern: /\b\d+\s?(mg|mcg|ml|gramos?|miligramos?|mililitros?)\b.{0,20}\b(cada|al d[ií]a|por d[ií]a|diari[ao]s?)\b/i,
    explanation: 'Menciona una cantidad y frecuencia que se lee como instruccion de dosificacion.',
  },
  {
    rule: 'INCITACION_COMPRA',
    pattern: /\b(compre ahora|adquiera ya|ordene hoy|aproveche esta oferta|descuento exclusivo)\b/i,
    explanation: 'Lenguaje que incita directamente a la compra.',
  },
  {
    rule: 'RECOMENDACION_TERAPEUTICA',
    pattern: /\b(usted debe tomar|se recomienda tomar|debe usar este medicamento|tome este producto)\b/i,
    explanation: 'Da una recomendacion terapeutica dirigida al lector.',
  },
  {
    rule: 'DIAGNOSTICO_PERSONALIZADO',
    pattern: /\b(usted tiene|si usted presenta estos sintomas, padece|esto significa que usted sufre)\b/i,
    explanation: 'Redactado como diagnostico dirigido personalmente al lector.',
  },
];

export function checkRegexRules(title: string, content: string): RegexRuleViolation[] {
  const text = `${title}\n${content}`;
  const violations: RegexRuleViolation[] = [];

  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (match) {
      violations.push({ rule: rule.rule, excerpt: match[0], explanation: rule.explanation });
    }
  }

  return violations;
}
