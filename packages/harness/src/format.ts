import type { HarnessReport, SatisfactionStatus } from './types.js';

export type ReporterKind = 'text' | 'json';

const STATUS_LABEL: Record<SatisfactionStatus, string> = {
  pass: 'pass   ',
  fail: 'fail   ',
  error: 'error  ',
  skipped: 'skipped',
};

export function formatReport(report: HarnessReport, kind: ReporterKind): string {
  if (kind === 'json') {
    return `${JSON.stringify(report, null, 2)}\n`;
  }
  return formatText(report);
}

function formatText(report: HarnessReport): string {
  const lines: string[] = [];
  const path = report.specPath ?? '<no path>';
  lines.push(`spec: ${report.specId}  (${path})`);
  lines.push(`started: ${report.startedAt}  duration: ${report.durationMs}ms`);
  lines.push('');

  for (const scenario of report.scenarios) {
    lines.push(
      `${STATUS_LABEL[scenario.status]}  ${scenario.scenarioId}  ` +
        `[${scenario.scenarioKind}]  (${scenario.durationMs}ms)`,
    );
    for (const sat of scenario.satisfactions) {
      const head = `  ${STATUS_LABEL[sat.status]}  ${sat.kind}:${sat.line}  ${sat.value}`;
      lines.push(head);
      if (sat.detail.trim() !== '') {
        const detail = sat.detail
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n');
        lines.push(detail);
      }
      if (sat.kind === 'judge' && typeof sat.score === 'number') {
        lines.push(`    score: ${sat.score.toFixed(2)}`);
      }
    }
  }

  if (report.scenarios.length === 0) {
    lines.push('(no scenarios executed)');
  }

  lines.push('');
  lines.push(
    `summary: pass=${report.summary.pass} fail=${report.summary.fail} ` +
      `error=${report.summary.error} skipped=${report.summary.skipped}  ` +
      `→ ${report.status}`,
  );
  return `${lines.join('\n')}\n`;
}
