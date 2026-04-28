import { describe, expect, test } from 'bun:test';
import { formatReport } from './format';
import type { HarnessReport } from './types';

const REPORT: HarnessReport = {
  specId: 'demo',
  specPath: 'docs/specs/demo.md',
  startedAt: '2026-04-28T12:00:00.000Z',
  durationMs: 250,
  scenarios: [
    {
      scenarioId: 'S-1',
      scenarioKind: 'scenario',
      status: 'pass',
      durationMs: 100,
      satisfactions: [
        {
          kind: 'test',
          value: 'src/foo.test.ts',
          line: 12,
          status: 'pass',
          durationMs: 90,
          detail: 'tests green',
          exitCode: 0,
        },
      ],
    },
    {
      scenarioId: 'S-2',
      scenarioKind: 'scenario',
      status: 'fail',
      durationMs: 150,
      satisfactions: [
        {
          kind: 'judge',
          value: 'reads naturally',
          line: 18,
          status: 'fail',
          durationMs: 140,
          detail: 'too curt',
          score: 0.2,
        },
      ],
    },
  ],
  summary: { pass: 1, fail: 1, error: 0, skipped: 0 },
  status: 'fail',
};

describe('formatReport', () => {
  test('json reporter produces a valid JSON document matching the report shape', () => {
    const out = formatReport(REPORT, 'json');
    expect(out.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(out);
    expect(parsed.specId).toBe('demo');
    expect(parsed.summary).toEqual({ pass: 1, fail: 1, error: 0, skipped: 0 });
    expect(parsed.status).toBe('fail');
    expect(parsed.scenarios).toHaveLength(2);
  });

  test('text reporter is grep-friendly: status, kind:line, value, detail, score', () => {
    const out = formatReport(REPORT, 'text');
    expect(out).toContain('spec: demo');
    expect(out).toContain('S-1');
    expect(out).toContain('S-2');
    expect(out).toContain('test:12');
    expect(out).toContain('judge:18');
    expect(out).toContain('src/foo.test.ts');
    expect(out).toContain('reads naturally');
    expect(out).toContain('score: 0.20');
    expect(out).toContain('summary: pass=1 fail=1 error=0 skipped=0');
    expect(out).toContain('→ fail');
  });

  test('text reporter shows a placeholder when there are zero scenarios', () => {
    const empty: HarnessReport = {
      ...REPORT,
      scenarios: [],
      summary: { pass: 0, fail: 0, error: 0, skipped: 0 },
      status: 'pass',
    };
    const out = formatReport(empty, 'text');
    expect(out).toContain('(no scenarios executed)');
    expect(out).toContain('→ pass');
  });
});
