/// Convierte los JSON Schema (draft-07, tipos en minuscula, nullable via
/// type:['string','null']) que ya usa cada *_TOOL_JSON_SCHEMA para Claude
/// al formato OpenAPI-ish que espera Gemini (responseSchema): tipos en
/// mayuscula y nullable:true en vez de una union de tipos. Evita mantener
/// dos definiciones de schema en paralelo por cada etapa (riesgo real de
/// que diverjan silenciosamente).
export function toGeminiSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== 'object') return schema;
  const s = schema as Record<string, unknown>;

  let type = s.type;
  let nullable = false;
  if (Array.isArray(type)) {
    nullable = type.includes('null');
    type = type.find((t) => t !== 'null');
  }

  const result: Record<string, unknown> = {};
  if (typeof type === 'string') result.type = type.toUpperCase();
  if (nullable) result.nullable = true;

  if (s.enum) {
    result.enum = (s.enum as unknown[]).filter((v) => v !== null);
  }
  if (s.properties) {
    result.properties = Object.fromEntries(
      Object.entries(s.properties as Record<string, unknown>).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  if (s.items) {
    result.items = toGeminiSchema(s.items);
  }
  if (s.required) {
    result.required = s.required;
  }

  return result;
}
