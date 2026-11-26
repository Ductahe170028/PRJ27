// Provider schema subsets differ. Constrain structure in the API, then enforce
// the COMPLETE bounds and cross-field rules using Zod before the level is built.
export function providerJsonSchema(value: unknown): Record<string, unknown> {
  const strip = new Set(['$schema', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']);
  function visit(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).filter(([key]) => !strip.has(key)).map(([key, val]) =>
        key === 'const' ? ['enum', [val]] : [key, visit(val)]));
    }
    return item;
  }
  return visit(value) as Record<string, unknown>;
}
