import { describe, expect, test } from 'bun:test';
import Ajv from 'ajv';
import { SPEC_FRONTMATTER_SCHEMA_ID, getFrontmatterJsonSchema } from './json-schema';

describe('getFrontmatterJsonSchema', () => {
  test('emits draft-07 schema with stable $id and title', () => {
    const schema = getFrontmatterJsonSchema();
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.$id).toBe(SPEC_FRONTMATTER_SCHEMA_ID);
    expect(schema.title).toBe('Factory Spec Frontmatter');
  });

  test('round-trips through Ajv: valid frontmatter passes', () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(getFrontmatterJsonSchema());
    const ok = validate({
      id: 'demo',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      exemplars: [],
    });
    expect(ok).toBe(true);
  });

  test('round-trips through Ajv: missing id fails with id-related error', () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(getFrontmatterJsonSchema());
    const ok = validate({
      classification: 'light',
      type: 'feat',
      status: 'ready',
    });
    expect(ok).toBe(false);
    const errors = validate.errors ?? [];
    const messages = errors.map(
      (e) => `${e.instancePath} ${e.message ?? ''} ${JSON.stringify(e.params)}`,
    );
    expect(messages.some((m) => m.includes('id'))).toBe(true);
  });

  test('round-trips through Ajv: invalid enum value fails', () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(getFrontmatterJsonSchema());
    const ok = validate({
      id: 'demo',
      classification: 'medium',
      type: 'feat',
      status: 'ready',
    });
    expect(ok).toBe(false);
  });

  test('exposes the documented enum values for tooling', () => {
    const schema = getFrontmatterJsonSchema() as {
      properties?: Record<string, { enum?: string[] }>;
    };
    expect(schema.properties?.classification?.enum).toEqual(['light', 'deep']);
    expect(schema.properties?.type?.enum).toEqual(['feat', 'fix', 'refactor', 'chore', 'perf']);
    expect(schema.properties?.status?.enum).toEqual(['ready', 'drafting', 'blocked']);
  });
});
