import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Spec } from '@wifo/factory-core';
import { runHarness } from './runner';
import type { JudgeClient, Judgment } from './runners/judge';

const HARNESS_ROOT = resolve(import.meta.dir, '..');

function buildSpec(args: {
  id?: string;
  scenarios?: Spec['scenarios'];
  holdouts?: Spec['holdouts'];
  body?: string;
}): Spec {
  return {
    frontmatter: {
      id: args.id ?? 'demo',
      classification: 'light',
      type: 'feat',
      status: 'ready',
      exemplars: [],
      'depends-on': [],
    },
    body: args.body ?? '',
    scenarios: args.scenarios ?? [],
    holdouts: args.holdouts ?? [],
    raw: { source: '' },
  };
}

function fakeJudge(judgment: Judgment): JudgeClient {
  return {
    async judge() {
      return judgment;
    },
  };
}

function scenario(args: {
  id: string;
  kind: 'scenario' | 'holdout';
  satisfaction?: { kind: 'test' | 'judge'; value: string; line: number }[];
}) {
  return {
    id: args.id,
    name: args.id,
    given: 'g',
    when: 'w',
    then: 't',
    satisfaction: args.satisfaction ?? [],
    line: 1,
    kind: args.kind,
  };
}

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) process.env.ANTHROPIC_API_KEY = '';
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

describe('runHarness', () => {
  test('all-passing test satisfactions yield a pass report', async () => {
    const spec = buildSpec({
      scenarios: [
        scenario({
          id: 'S-1',
          kind: 'scenario',
          satisfaction: [{ kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 }],
        }),
      ],
    });
    const report = await runHarness(spec, { cwd: HARNESS_ROOT });
    expect(report.status).toBe('pass');
    expect(report.summary).toEqual({ pass: 1, fail: 0, error: 0, skipped: 0 });
  }, 30_000);

  test('aggregates mixed results: pass, fail (test), fail (judge)', async () => {
    const spec = buildSpec({
      body: 'spec body',
      scenarios: [
        scenario({
          id: 'S-1',
          kind: 'scenario',
          satisfaction: [{ kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 }],
        }),
        scenario({
          id: 'S-2',
          kind: 'scenario',
          satisfaction: [{ kind: 'test', value: 'test-fixtures/failing.test.ts', line: 1 }],
        }),
        scenario({
          id: 'S-3',
          kind: 'scenario',
          satisfaction: [{ kind: 'judge', value: 'be friendly', line: 1 }],
        }),
      ],
    });
    const report = await runHarness(spec, {
      cwd: HARNESS_ROOT,
      judge: { client: fakeJudge({ pass: false, score: 0.1, reasoning: 'too curt' }) },
    });
    expect(report.status).toBe('fail');
    expect(report.summary).toEqual({ pass: 1, fail: 2, error: 0, skipped: 0 });
    const ids = report.scenarios.map((s) => s.scenarioId);
    expect(ids).toEqual(['S-1', 'S-2', 'S-3']);
    expect(report.scenarios[0]?.status).toBe('pass');
    expect(report.scenarios[1]?.status).toBe('fail');
    expect(report.scenarios[2]?.status).toBe('fail');
  }, 60_000);

  test('fail-fast on missing api key — returns error report, never throws', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    const spec = buildSpec({
      scenarios: [
        scenario({
          id: 'S-1',
          kind: 'scenario',
          satisfaction: [{ kind: 'judge', value: 'whatever', line: 1 }],
        }),
      ],
    });
    const report = await runHarness(spec, { cwd: HARNESS_ROOT });
    expect(report.status).toBe('error');
    const detail = report.scenarios
      .flatMap((s) => s.satisfactions)
      .map((s) => s.detail)
      .join('\n');
    expect(detail).toContain('runner/missing-api-key');
    // No scenario was executed.
    expect(report.scenarios.length).toBe(1);
    expect(report.scenarios[0]?.scenarioId).toBe('<runner>');
  });

  test('--no-judge skips judge satisfactions with status=skipped', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    const spec = buildSpec({
      scenarios: [
        scenario({
          id: 'S-1',
          kind: 'scenario',
          satisfaction: [
            { kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 },
            { kind: 'judge', value: 'reads naturally', line: 2 },
          ],
        }),
      ],
    });
    const report = await runHarness(spec, { cwd: HARNESS_ROOT, noJudge: true });
    expect(report.status).toBe('pass');
    const sats = report.scenarios[0]?.satisfactions ?? [];
    expect(sats[0]?.status).toBe('pass');
    expect(sats[1]?.status).toBe('skipped');
    expect(sats[1]?.detail).toBe('--no-judge');
  }, 30_000);

  test('scenarioIds filter restricts execution to the listed ids', async () => {
    const spec = buildSpec({
      scenarios: [
        scenario({
          id: 'S-1',
          kind: 'scenario',
          satisfaction: [{ kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 }],
        }),
        scenario({
          id: 'S-2',
          kind: 'scenario',
          satisfaction: [{ kind: 'test', value: 'test-fixtures/failing.test.ts', line: 1 }],
        }),
      ],
    });
    const report = await runHarness(spec, {
      cwd: HARNESS_ROOT,
      scenarioIds: new Set(['S-1']),
    });
    expect(report.scenarios.map((s) => s.scenarioId)).toEqual(['S-1']);
    expect(report.status).toBe('pass');
  }, 30_000);

  test('visibleOnly excludes holdouts; holdoutsOnly excludes visible', async () => {
    const spec = buildSpec({
      scenarios: [
        scenario({
          id: 'S-1',
          kind: 'scenario',
          satisfaction: [{ kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 }],
        }),
      ],
      holdouts: [
        scenario({
          id: 'H-1',
          kind: 'holdout',
          satisfaction: [{ kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 }],
        }),
      ],
    });
    const visible = await runHarness(spec, { cwd: HARNESS_ROOT, visibleOnly: true });
    expect(visible.scenarios.map((s) => s.scenarioId)).toEqual(['S-1']);

    const holds = await runHarness(spec, { cwd: HARNESS_ROOT, holdoutsOnly: true });
    expect(holds.scenarios.map((s) => s.scenarioId)).toEqual(['H-1']);
  }, 60_000);

  test('cost notice fires when more than 5 judge calls are queued', async () => {
    const lines: string[] = [];
    const judges = Array.from({ length: 6 }, (_, i) => ({
      kind: 'judge' as const,
      value: `criterion ${i}`,
      line: i + 1,
    }));
    const spec = buildSpec({
      scenarios: [scenario({ id: 'S-1', kind: 'scenario', satisfaction: judges })],
    });
    await runHarness(spec, {
      cwd: HARNESS_ROOT,
      judge: { client: fakeJudge({ pass: true, score: 1, reasoning: 'ok' }) },
      log: (line) => lines.push(line),
    });
    expect(lines.some((l) => l.includes('6 judge calls planned'))).toBe(true);
  });

  test('test name with apostrophe matches it() name without apostrophe under normalization', async () => {
    // Verify normalization end-to-end: the spec's `test:` pattern carries an
    // apostrophe that the implementation dropped from the actual `it()` name.
    // The runner must strip apostrophes from the pattern before passing -t so
    // bun's regex match still hits the un-apostrophed test name. Fake bun
    // captures the args and asserts the apostrophe is gone.
    const tmp = mkdtempSync(join(tmpdir(), 'fake-bun-norm-'));
    try {
      const fakeBun = join(tmp, 'fake-bun.sh');
      writeFileSync(
        fakeBun,
        [
          '#!/usr/bin/env bash',
          'pattern=""',
          'next_is_pattern=0',
          'for arg in "$@"; do',
          '  if [ "$next_is_pattern" = "1" ]; then pattern="$arg"; next_is_pattern=0; fi',
          '  if [ "$arg" = "-t" ]; then next_is_pattern=1; fi',
          'done',
          'echo "PATTERN: $pattern"',
          'if echo "$pattern" | grep -q "\'"; then',
          '  echo "unexpected apostrophe in pattern"',
          '  exit 1',
          'fi',
          'echo "1 pass"',
          'echo "1 filtered out"',
          'exit 0',
          '',
        ].join('\n'),
      );
      chmodSync(fakeBun, 0o755);

      const spec = buildSpec({
        scenarios: [
          scenario({
            id: 'S-1',
            kind: 'scenario',
            satisfaction: [
              {
                kind: 'test',
                value: 'test-fixtures/normalize.test.ts "v0.0.10\'s hash"',
                line: 1,
              },
            ],
          }),
        ],
      });
      const report = await runHarness(spec, { cwd: HARNESS_ROOT, bunPath: fakeBun });
      expect(report.status).toBe('pass');
      const detail = report.scenarios[0]?.satisfactions[0]?.detail ?? '';
      expect(detail).toContain('1 pass');
      expect(detail).toContain('1 filtered out');
      // Confirm the harness stripped the apostrophe before -t (regex dots
      // remain escaped — that's the existing pre-v0.0.12 behavior).
      expect(detail).not.toContain("v0.0.10's hash");
      expect(detail).toContain('v0\\.0\\.10s hash');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  test('empty selection: only holdouts present and visibleOnly set returns pass-with-zero-scenarios', async () => {
    const spec = buildSpec({
      holdouts: [
        scenario({
          id: 'H-1',
          kind: 'holdout',
          satisfaction: [{ kind: 'test', value: 'test-fixtures/passing.test.ts', line: 1 }],
        }),
      ],
    });
    const report = await runHarness(spec, { cwd: HARNESS_ROOT, visibleOnly: true });
    expect(report.scenarios.length).toBe(0);
    expect(report.status).toBe('pass');
    expect(report.summary).toEqual({ pass: 0, fail: 0, error: 0, skipped: 0 });
  });
});
