import { describe, expect, test } from 'bun:test';
import { type ReviewFinding, formatFindings, sortFindings } from './findings.js';

describe('formatFindings — line template byte-identical to lint', () => {
  test('error finding renders with `error  ` padded severity + 28-char code padding', () => {
    const findings: ReviewFinding[] = [
      {
        file: 'spec.md',
        line: 10,
        severity: 'error',
        code: 'review/judge-failed',
        message: 'judge/malformed-response',
      },
    ];
    const out = formatFindings(findings);
    expect(out).toBe(
      'spec.md:10  error    review/judge-failed           judge/malformed-response\n' +
        '1 error, 0 warnings\n',
    );
  });

  test('warning + info findings render with their padded severities', () => {
    const findings: ReviewFinding[] = [
      {
        file: 'spec.md',
        line: 5,
        severity: 'warning',
        code: 'review/internal-consistency',
        message: 'unreferenced dep',
      },
      {
        file: 'spec.md',
        line: 12,
        severity: 'info',
        code: 'review/section-missing',
        message: "Section '## Definition of Done' not found; dod-precision skipped",
      },
    ];
    const out = formatFindings(findings);
    expect(out).toContain('spec.md:5  warning  review/internal-consistency   unreferenced dep\n');
    expect(out).toContain(
      "spec.md:12  info     review/section-missing        Section '## Definition of Done' not found; dod-precision skipped\n",
    );
    // Summary excludes info from counts (mirrors lint's behavior).
    expect(out).toContain('0 errors, 1 warning\n');
  });

  test('singular vs plural in summary', () => {
    expect(
      formatFindings([{ severity: 'error', code: 'review/judge-failed', message: 'x', file: 'a' }]),
    ).toContain('1 error, 0 warnings\n');
    expect(
      formatFindings([
        { severity: 'error', code: 'review/judge-failed', message: 'x', file: 'a' },
        { severity: 'error', code: 'review/judge-failed', message: 'y', file: 'a' },
      ]),
    ).toContain('2 errors, 0 warnings\n');
    expect(
      formatFindings([
        { severity: 'warning', code: 'review/dod-precision', message: 'x', file: 'a' },
      ]),
    ).toContain('0 errors, 1 warning\n');
  });

  test('empty findings → empty string (no summary)', () => {
    expect(formatFindings([])).toBe('');
  });

  test('missing line: file is rendered without `:N` suffix', () => {
    const out = formatFindings([
      {
        file: 'spec.md',
        severity: 'warning',
        code: 'review/judge-parity',
        message: 'asymmetric',
      },
    ]);
    expect(out).toContain('spec.md  warning  review/judge-parity           asymmetric\n');
  });

  test('missing file: falls back to opts.file then to <input>', () => {
    const f: ReviewFinding = { severity: 'warning', code: 'review/judge-parity', message: 'x' };
    expect(formatFindings([f], { file: 'opts.md' })).toContain('opts.md  warning');
    expect(formatFindings([f])).toContain('<input>  warning');
  });
});

describe('sortFindings', () => {
  test('sorts by line ASC then code ASC', () => {
    const findings: ReviewFinding[] = [
      { file: 'a', line: 20, severity: 'warning', code: 'review/judge-parity', message: 'x' },
      {
        file: 'a',
        line: 10,
        severity: 'warning',
        code: 'review/internal-consistency',
        message: 'x',
      },
      { file: 'a', line: 10, severity: 'warning', code: 'review/dod-precision', message: 'x' },
    ];
    const sorted = sortFindings(findings);
    expect(sorted[0]?.code).toBe('review/dod-precision');
    expect(sorted[1]?.code).toBe('review/internal-consistency');
    expect(sorted[2]?.code).toBe('review/judge-parity');
  });

  test('findings without line sort to the end', () => {
    const findings: ReviewFinding[] = [
      { file: 'a', severity: 'warning', code: 'review/judge-parity', message: 'x' },
      { file: 'a', line: 5, severity: 'warning', code: 'review/dod-precision', message: 'x' },
    ];
    const sorted = sortFindings(findings);
    expect(sorted[0]?.line).toBe(5);
    expect(sorted[1]?.line).toBeUndefined();
  });
});
