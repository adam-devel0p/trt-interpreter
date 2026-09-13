import { z } from 'zod';

/**
 * Structured-output schemas accept a subset of JSON Schema. Zod's emitter adds length, range
 * and pattern constraints the endpoint may reject, so they are stripped here; Zod still
 * enforces them on the parsed value in run.ts. Kept in its own module so a provider test can
 * assert the shape without a network.
 */
const DROP = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'pattern',
  'format',
  'multipleOf',
  'uniqueItems',
  'default',
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (DROP.has(k)) continue;
    out[k] = strip(v);
  }
  // Structured outputs require every object to close its property set.
  if (out.type === 'object' && out.additionalProperties === undefined) {
    out.additionalProperties = false;
  }
  return out;
}

export function toOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}
