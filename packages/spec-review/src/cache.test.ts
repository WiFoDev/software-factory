import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheGet, cacheSet, computeCacheKey } from './cache.js';
import type { ReviewFinding } from './findings.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spec-review-cache-'));
});
afterEach(async () => {
  await Bun.$`rm -rf ${dir}`.quiet().nothrow();
});

describe('computeCacheKey', () => {
  test('different spec bytes → different key', () => {
    const a = computeCacheKey({
      specBytes: 'spec content A',
      ruleSetHash: 'r1',
      enabledJudges: ['review/internal-consistency'],
    });
    const b = computeCacheKey({
      specBytes: 'spec content B',
      ruleSetHash: 'r1',
      enabledJudges: ['review/internal-consistency'],
    });
    expect(a).not.toBe(b);
  });

  test('different ruleSetHash → different key', () => {
    const a = computeCacheKey({
      specBytes: 'spec',
      ruleSetHash: 'r1',
      enabledJudges: ['review/internal-consistency'],
    });
    const b = computeCacheKey({
      specBytes: 'spec',
      ruleSetHash: 'r2',
      enabledJudges: ['review/internal-consistency'],
    });
    expect(a).not.toBe(b);
  });

  test('different enabled-judges set → different key', () => {
    const a = computeCacheKey({
      specBytes: 'spec',
      ruleSetHash: 'r1',
      enabledJudges: ['review/internal-consistency'],
    });
    const b = computeCacheKey({
      specBytes: 'spec',
      ruleSetHash: 'r1',
      enabledJudges: ['review/internal-consistency', 'review/dod-precision'],
    });
    expect(a).not.toBe(b);
  });

  test('judge order is normalized — same set in different order = same key', () => {
    const a = computeCacheKey({
      specBytes: 'spec',
      ruleSetHash: 'r1',
      enabledJudges: ['review/internal-consistency', 'review/dod-precision'],
    });
    const b = computeCacheKey({
      specBytes: 'spec',
      ruleSetHash: 'r1',
      enabledJudges: ['review/dod-precision', 'review/internal-consistency'],
    });
    expect(a).toBe(b);
  });
});

describe('cacheGet / cacheSet', () => {
  test('round-trip: write then read returns the same findings', () => {
    const findings: ReviewFinding[] = [
      {
        file: 'spec.md',
        line: 5,
        severity: 'warning',
        code: 'review/internal-consistency',
        message: 'unreferenced dep',
      },
    ];
    cacheSet(dir, 'abc', findings);
    expect(cacheGet(dir, 'abc')).toEqual(findings);
  });

  test('cacheGet on missing file returns null', () => {
    expect(cacheGet(dir, 'never-written')).toBeNull();
  });

  test('cacheGet on malformed JSON returns null (treated as miss)', () => {
    writeFileSync(join(dir, 'bad.json'), '{not json');
    expect(cacheGet(dir, 'bad')).toBeNull();
  });

  test('cacheGet on shape mismatch (not array) returns null', () => {
    writeFileSync(join(dir, 'shapebad.json'), '{"oops": true}');
    expect(cacheGet(dir, 'shapebad')).toBeNull();
  });

  test('cacheGet on shape mismatch (bad severity) returns null', () => {
    writeFileSync(
      join(dir, 'sevbad.json'),
      JSON.stringify([{ severity: 'NOPE', code: 'x', message: 'y' }]),
    );
    expect(cacheGet(dir, 'sevbad')).toBeNull();
  });

  test('cacheSet writes atomically — final file appears, no .tmp leftovers', () => {
    cacheSet(dir, 'atomic-test', []);
    const files = readdirSync(dir);
    expect(files).toContain('atomic-test.json');
    for (const f of files) {
      expect(f.startsWith('.')).toBe(false);
    }
  });

  test('cacheSet creates the cache dir if it does not exist', () => {
    const nested = join(dir, 'nested', 'deep');
    expect(existsSync(nested)).toBe(false);
    cacheSet(nested, 'x', []);
    expect(existsSync(join(nested, 'x.json'))).toBe(true);
  });
});
