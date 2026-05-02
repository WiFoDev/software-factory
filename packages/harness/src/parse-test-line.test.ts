import { describe, expect, test } from 'bun:test';
import { parseTestLine } from './parse-test-line';

describe('parseTestLine', () => {
  test('handles every accepted format', () => {
    expect(parseTestLine('src/foo.test.ts')).toEqual({ file: 'src/foo.test.ts' });

    expect(parseTestLine('src/foo.test.ts "happy path"')).toEqual({
      file: 'src/foo.test.ts',
      pattern: 'happy path',
    });

    expect(parseTestLine('src/foo.test.ts happy path')).toEqual({
      file: 'src/foo.test.ts',
      pattern: 'happy path',
    });

    expect(parseTestLine('"happy path"')).toEqual({ pattern: 'happy path' });
  });

  test('detects path-segment files even without a known extension', () => {
    expect(parseTestLine('tests/foo "x"')).toEqual({ file: 'tests/foo', pattern: 'x' });
  });

  test('treats a bare token without extension or path as a pattern', () => {
    expect(parseTestLine('greet')).toEqual({ pattern: 'greet' });
  });

  test('strips surrounding double quotes from the pattern', () => {
    expect(parseTestLine('a.test.ts "exact match"').pattern).toBe('exact match');
    // Inner double quotes are not unwrapped when no surrounding pair.
    expect(parseTestLine('a.test.ts a "b" c').pattern).toBe('a "b" c');
  });

  test('passes regex metacharacters through verbatim', () => {
    expect(parseTestLine('a.test.ts "es-PE returns Spanish"').pattern).toBe(
      'es-PE returns Spanish',
    );
    expect(parseTestLine('a.test.ts "(group)"').pattern).toBe('(group)');
  });

  test('returns empty object for empty input', () => {
    expect(parseTestLine('')).toEqual({});
    expect(parseTestLine('   ')).toEqual({});
  });

  test('handles file with all recognised extensions', () => {
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs']) {
      expect(parseTestLine(`a${ext}`).file).toBe(`a${ext}`);
    }
  });

  test('bare path passes through unchanged', () => {
    expect(parseTestLine('src/foo.test.ts "happy path"')).toEqual({
      file: 'src/foo.test.ts',
      pattern: 'happy path',
    });
  });

  test('backtick-wrapped path strips to bare', () => {
    expect(parseTestLine('`src/foo.test.ts` "happy path"')).toEqual({
      file: 'src/foo.test.ts',
      pattern: 'happy path',
    });
  });

  test('backtick-wrapped pattern strips to bare', () => {
    expect(parseTestLine('src/foo.test.ts `happy path`')).toEqual({
      file: 'src/foo.test.ts',
      pattern: 'happy path',
    });
  });

  test('mid-string backticks survive', () => {
    expect(parseTestLine('`src/foo.test.ts` "match `inner` token"')).toEqual({
      file: 'src/foo.test.ts',
      pattern: 'match `inner` token',
    });
  });
});
