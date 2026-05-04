// ReviewFinding mirrors factory-core's LintError shape so the two checkers'
// output streams compose cleanly. Only difference: the `code` namespace is
// `review/...` rather than `spec/...`, and we add an `info` severity for
// non-fatal "judge skipped because section missing" reports.

export type ReviewSeverity = 'error' | 'warning' | 'info';

export type ReviewCode =
  | 'review/internal-consistency'
  | 'review/judge-parity'
  | 'review/dod-precision'
  | 'review/holdout-distinctness'
  | 'review/cross-doc-consistency'
  | 'review/api-surface-drift'
  | 'review/feasibility'
  | 'review/scope-creep'
  | 'review/judge-failed'
  | 'review/section-missing'
  | 'review/dep-not-found';

export interface ReviewFinding {
  file?: string;
  line?: number;
  severity: ReviewSeverity;
  code: ReviewCode;
  message: string;
}

/**
 * Format findings as `file:line  sev  code  message` lines plus a summary.
 * Byte-identical to `factory spec lint`'s line template (cli.ts:171) modulo
 * the namespace of the `code` field. The `info` severity reuses the same
 * 7-char-padded slot as `error  ` / `warning`.
 */
export function formatFindings(findings: ReviewFinding[], opts: { file?: string } = {}): string {
  const lines: string[] = [];
  for (const f of findings) {
    const file = f.file ?? opts.file ?? '<input>';
    const line = f.line !== undefined ? `:${f.line}` : '';
    const sev =
      f.severity === 'error' ? 'error  ' : f.severity === 'warning' ? 'warning' : 'info   ';
    lines.push(`${file}${line}  ${sev}  ${f.code.padEnd(28)}  ${f.message}\n`);
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  if (findings.length > 0) {
    const errPart = `${errors} error${errors === 1 ? '' : 's'}`;
    const warnPart = `${warnings} warning${warnings === 1 ? '' : 's'}`;
    lines.push(`${errPart}, ${warnPart}\n`);
  }
  return lines.join('');
}

/**
 * Sort findings by line then code, mirroring lint's deterministic ordering
 * for stable output across runs.
 */
export function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => {
    const al = a.line ?? Number.POSITIVE_INFINITY;
    const bl = b.line ?? Number.POSITIVE_INFINITY;
    if (al !== bl) return al - bl;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
}
