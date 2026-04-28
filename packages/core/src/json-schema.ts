import { zodToJsonSchema } from 'zod-to-json-schema';
import { SpecFrontmatterSchema } from './schema.js';

export const SPEC_FRONTMATTER_SCHEMA_ID =
  'https://wifo.dev/schemas/factory-core/spec-frontmatter.json';

export function getFrontmatterJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(SpecFrontmatterSchema, {
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  // Strip the auto-injected $schema so we can prepend our own (and our $id).
  const { $schema: _ignored, ...rest } = schema;
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: SPEC_FRONTMATTER_SCHEMA_ID,
    title: 'Factory Spec Frontmatter',
    ...rest,
  };
}
