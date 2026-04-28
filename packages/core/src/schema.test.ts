import { describe, expect, test } from 'bun:test';
import { SpecFrontmatterSchema } from './schema';

describe('SpecFrontmatterSchema', () => {
  test('parses a valid frontmatter object', () => {
    const result = SpecFrontmatterSchema.parse({
      id: 'demo-1',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      exemplars: [{ path: 'src/foo.ts', why: 'reference impl' }],
    });
    expect(result.id).toBe('demo-1');
    expect(result.exemplars).toHaveLength(1);
  });

  test('defaults exemplars to an empty array', () => {
    const result = SpecFrontmatterSchema.parse({
      id: 'demo-2',
      classification: 'deep',
      type: 'feat',
      status: 'drafting',
    });
    expect(result.exemplars).toEqual([]);
  });

  test('fails when a required field is missing', () => {
    const parsed = SpecFrontmatterSchema.safeParse({
      classification: 'light',
      type: 'feat',
      status: 'ready',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join('.'));
      expect(fields).toContain('id');
    }
  });

  test('fails when an enum value is invalid', () => {
    const parsed = SpecFrontmatterSchema.safeParse({
      id: 'demo-3',
      classification: 'medium',
      type: 'feat',
      status: 'ready',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join('.'));
      expect(fields).toContain('classification');
    }
  });

  test('rejects unknown top-level fields (strict)', () => {
    const parsed = SpecFrontmatterSchema.safeParse({
      id: 'demo-4',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      owner: 'wifo',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const codes = parsed.error.issues.map((issue) => issue.code);
      expect(codes).toContain('unrecognized_keys');
    }
  });

  test('rejects exemplar without path or why', () => {
    const parsed = SpecFrontmatterSchema.safeParse({
      id: 'demo-5',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      exemplars: [{ path: 'src/foo.ts' }],
    });
    expect(parsed.success).toBe(false);
  });
});
