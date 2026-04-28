import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { runTestSatisfaction, stripAnsi, tailDetail } from './test';

const HARNESS_ROOT = resolve(import.meta.dir, '../..');

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
