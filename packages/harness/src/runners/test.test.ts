import { beforeAll, describe, expect, test } from 'bun:test';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { runTestSatisfaction, stripAnsi, tailDetail } from './test';

const HARNESS_ROOT = resolve(import.meta.dir, '../..');
const FAKE_BUN = resolve(HARNESS_ROOT, 'test-fixtures/fake-bun.sh');

describe('stripAnsi', () => {
  test('removes CSI colour sequences', () => {
    const input = '\x1b[31mred\x1b[0m';
    expect(stripAnsi(input)).toBe('red');
  });

  test('passes plain text through', () => {
    expect(stripAnsi('hello [world]')).toBe('hello [world]');
  });
});

describe('tailDetail', () => {
  test('keeps the last 20 lines', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`);
    const out = tailDetail(lines.join('\n'));
    expect(out.split('\n')).toHaveLength(20);
    expect(out.startsWith('line 6')).toBe(true);
    expect(out.endsWith('line 25')).toBe(true);
  });

  test('caps at 4 KB and prepends a truncation marker', () => {
    const huge = 'x'.repeat(10 * 1024);
    const out = tailDetail(huge);
    expect(out.length).toBeLessThanOrEqual(4 * 1024 + 32);
    expect(out.startsWith('\n… [truncated]')).toBe(true);
  });
});

describe('runTestSatisfaction', () => {
  test('passes when fixture exits 0', async () => {
    const result = await runTestSatisfaction(
      { kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 },
      { cwd: HARNESS_ROOT, timeoutMs: 30_000 },
    );
    expect(result.status).toBe('pass');
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.kind).toBe('test');
  }, 30_000);

  test('fails when fixture exits non-zero', async () => {
    const result = await runTestSatisfaction(
      { kind: 'test', value: 'test-fixtures/failing.test.ts', line: 1 },
      { cwd: HARNESS_ROOT, timeoutMs: 30_000 },
    );
    expect(result.status).toBe('fail');
    expect(result.exitCode).not.toBe(0);
    expect(result.detail).toContain('failing-arithmetic');
  }, 30_000);

  test('filters by pattern (-t) so only the matching test runs', async () => {
    const result = await runTestSatisfaction(
      { kind: 'test', value: 'test-fixtures/passing.test.ts "passing-arithmetic"', line: 1 },
      { cwd: HARNESS_ROOT, timeoutMs: 30_000 },
    );
    expect(result.status).toBe('pass');
    // bun reports one test ran and the other was filtered out by -t.
    expect(result.detail).toContain('1 pass');
    expect(result.detail).toContain('1 filtered out');
  }, 30_000);

  test('returns status=error with runner/spawn-failed when bun is not on PATH', async () => {
    const result = await runTestSatisfaction(
      { kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 },
      { cwd: HARNESS_ROOT, timeoutMs: 30_000, bunPath: '/definitely/not/bun-xyz' },
    );
    expect(result.status).toBe('error');
    expect(result.detail).toContain('runner/spawn-failed');
  });

  describe('coverage trip detection (v0.0.13)', () => {
    beforeAll(() => {
      // Ensure the fixture is executable regardless of git mode bits.
      chmodSync(FAKE_BUN, 0o755);
    });

    test('0 fail + nonzero exit classified as pass with coverage-threshold-tripped detail', async () => {
      const result = await runTestSatisfaction(
        { kind: 'test', value: 'coverage-trip.test.ts', line: 1 },
        { cwd: HARNESS_ROOT, timeoutMs: 30_000, bunPath: FAKE_BUN },
      );
      expect(result.status).toBe('pass');
      expect(result.detail).toContain('harness/coverage-threshold-tripped');
      expect(result.detail).toContain('coverage threshold of 0.8 not met');
      // The bun pass count is preserved in the detail tail.
      expect(result.detail).toContain('1 pass');
      expect(result.exitCode).not.toBe(0);
    }, 30_000);

    test('real test failures still classified as fail (regression-pin)', async () => {
      const result = await runTestSatisfaction(
        { kind: 'test', value: 'real-fail.test.ts', line: 1 },
        { cwd: HARNESS_ROOT, timeoutMs: 30_000, bunPath: FAKE_BUN },
      );
      expect(result.status).toBe('fail');
      expect(result.detail).not.toContain('harness/coverage-threshold-tripped');
      expect(result.detail).toContain('1 fail');
      expect(result.exitCode).not.toBe(0);
    }, 30_000);

    test('fake-bun coverage-threshold output shape recognized via stdout parse', async () => {
      const result = await runTestSatisfaction(
        { kind: 'test', value: 'coverage-trip.test.ts', line: 1 },
        { cwd: HARNESS_ROOT, timeoutMs: 30_000, bunPath: FAKE_BUN },
      );
      expect(result.status).toBe('pass');
      expect(result.detail).toContain('harness/coverage-threshold-tripped');
      // The 1 pass count from bun's output is preserved in the detail tail.
      expect(result.detail).toContain('1 pass');
    }, 30_000);

    test('fake-bun 0 fail + exit 0 still pass with no coverage-trip prefix', async () => {
      const result = await runTestSatisfaction(
        { kind: 'test', value: 'clean-pass.test.ts', line: 1 },
        { cwd: HARNESS_ROOT, timeoutMs: 30_000, bunPath: FAKE_BUN },
      );
      expect(result.status).toBe('pass');
      expect(result.exitCode).toBe(0);
      expect(result.detail).not.toContain('harness/coverage-threshold-tripped');
    }, 30_000);

    test('0 fail + nonzero exit without coverage marker still classified as fail', async () => {
      const result = await runTestSatisfaction(
        { kind: 'test', value: 'no-marker.test.ts', line: 1 },
        { cwd: HARNESS_ROOT, timeoutMs: 30_000, bunPath: FAKE_BUN },
      );
      expect(result.status).toBe('fail');
      expect(result.detail).not.toContain('harness/coverage-threshold-tripped');
      expect(result.exitCode).not.toBe(0);
    }, 30_000);
  });

  describe('regex-no-match safety net (v0.0.14)', () => {
    beforeAll(() => {
      chmodSync(FAKE_BUN, 0o755);
    });

    test('regex matched 0 tests + nonzero exit classified as error with harness/test-name-regex-no-match prefix', async () => {
      const result = await runTestSatisfaction(
        { kind: 'test', value: 'regex-no-match.test.ts "missing-name"', line: 1 },
        { cwd: HARNESS_ROOT, timeoutMs: 30_000, bunPath: FAKE_BUN },
      );
      expect(result.status).toBe('error');
      expect(result.detail).toContain('harness/test-name-regex-no-match');
      expect(result.detail).toContain('matched 0 tests');
      expect(result.detail).toContain('regex-no-match.test.ts');
      expect(result.exitCode).not.toBe(0);
    }, 30_000);

    test('regex matched 0 tests path does not collide with v0.0.13 coverage-trip path', async () => {
      // When both signals appear, the coverage-trip path wins (it gates on
      // `0 fail` + the threshold marker, both true here). The regex-no-match
      // detector must NOT fire and the result stays `pass`.
      const result = await runTestSatisfaction(
        { kind: 'test', value: 'regex-no-match-with-coverage.test.ts "x"', line: 1 },
        { cwd: HARNESS_ROOT, timeoutMs: 30_000, bunPath: FAKE_BUN },
      );
      expect(result.status).toBe('pass');
      expect(result.detail).toContain('harness/coverage-threshold-tripped');
      expect(result.detail).not.toContain('harness/test-name-regex-no-match');
    }, 30_000);

    test('real test failures still classify as fail (v0.0.14 regression-pin)', async () => {
      const result = await runTestSatisfaction(
        { kind: 'test', value: 'real-fail.test.ts', line: 1 },
        { cwd: HARNESS_ROOT, timeoutMs: 30_000, bunPath: FAKE_BUN },
      );
      expect(result.status).toBe('fail');
      expect(result.detail).not.toContain('harness/test-name-regex-no-match');
      expect(result.detail).not.toContain('harness/coverage-threshold-tripped');
      expect(result.detail).toContain('1 fail');
      expect(result.exitCode).not.toBe(0);
    }, 30_000);
  });

  test('times out cleanly without crashing the process', async () => {
    const result = await runTestSatisfaction(
      { kind: 'test', value: 'test-fixtures/slow.test.ts', line: 1 },
      { cwd: HARNESS_ROOT, timeoutMs: 200 },
    );
    expect(result.status).toBe('error');
    expect(result.detail).toContain('runner/timeout');

    // A subsequent call still works.
    const followup = await runTestSatisfaction(
      { kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 },
      { cwd: HARNESS_ROOT, timeoutMs: 30_000 },
    );
    expect(followup.status).toBe('pass');
  }, 30_000);
});
