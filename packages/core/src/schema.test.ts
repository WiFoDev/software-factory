import { describe, expect, test } from 'bun:test';
import { KEBAB_ID_REGEX, SpecFrontmatterSchema } from './schema';

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

  test('SpecFrontmatterSchema accepts depends-on with kebab-case ids', () => {
    const result = SpecFrontmatterSchema.parse({
      id: 'demo-6',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      'depends-on': ['foo-bar', 'baz-qux'],
    });
    expect(result['depends-on']).toEqual(['foo-bar', 'baz-qux']);
  });

  test('SpecFrontmatterSchema defaults depends-on to empty array when absent', () => {
    const result = SpecFrontmatterSchema.parse({
      id: 'demo-7',
      classification: 'light',
      type: 'feat',
      status: 'ready',
    });
    expect(result['depends-on']).toEqual([]);
  });

  test('SpecFrontmatterSchema accepts empty depends-on array', () => {
    const result = SpecFrontmatterSchema.parse({
      id: 'demo-8',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      'depends-on': [],
    });
    expect(result['depends-on']).toEqual([]);
  });

  test('SpecFrontmatterSchema accepts agent-timeout-ms as a positive integer', () => {
    const result = SpecFrontmatterSchema.parse({
      id: 'demo-9',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      'agent-timeout-ms': 1_200_000,
    });
    expect(result['agent-timeout-ms']).toBe(1_200_000);
  });

  test('SpecFrontmatterSchema leaves agent-timeout-ms undefined when absent', () => {
    const result = SpecFrontmatterSchema.parse({
      id: 'demo-10',
      classification: 'light',
      type: 'feat',
      status: 'ready',
    });
    expect(result['agent-timeout-ms']).toBeUndefined();
  });

  test('SpecFrontmatterSchema rejects non-positive agent-timeout-ms', () => {
    const zero = SpecFrontmatterSchema.safeParse({
      id: 'demo-11',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      'agent-timeout-ms': 0,
    });
    expect(zero.success).toBe(false);

    const negative = SpecFrontmatterSchema.safeParse({
      id: 'demo-11',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      'agent-timeout-ms': -100,
    });
    expect(negative.success).toBe(false);

    const float = SpecFrontmatterSchema.safeParse({
      id: 'demo-11',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      'agent-timeout-ms': 1.5,
    });
    expect(float.success).toBe(false);
  });
});

describe('KEBAB_ID_REGEX', () => {
  test('matches valid kebab-case ids', () => {
    expect(KEBAB_ID_REGEX.test('foo')).toBe(true);
    expect(KEBAB_ID_REGEX.test('foo-bar')).toBe(true);
    expect(KEBAB_ID_REGEX.test('factory-runtime-v0-0-7')).toBe(true);
    expect(KEBAB_ID_REGEX.test('a1-b2-c3')).toBe(true);
  });

  test('rejects invalid ids', () => {
    expect(KEBAB_ID_REGEX.test('Foo')).toBe(false);
    expect(KEBAB_ID_REGEX.test('1foo')).toBe(false);
    expect(KEBAB_ID_REGEX.test('-foo')).toBe(false);
    expect(KEBAB_ID_REGEX.test('foo_bar')).toBe(false);
    expect(KEBAB_ID_REGEX.test('foo bar')).toBe(false);
    expect(KEBAB_ID_REGEX.test('')).toBe(false);
  });
});
