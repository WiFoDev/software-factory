import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeDef } from './index.js';

const CRITERION =
  'Scenarios that share a category (error UX, success path, performance, ' +
  'failure mode) have uniform satisfaction kinds. If two scenarios both ' +
  "test error UX but only one has a `judge:` line, that's an asymmetry — " +
  'flag it. The principle: similar categories of behavior should be ' +
  'evaluated by similar means.';

function renderScenarios(spec: Spec): string {
  const lines: string[] = [];
  for (const s of spec.scenarios) {
    lines.push(`### ${s.id} — ${s.name}`);
    lines.push(`Given: ${s.given}`);
    lines.push(`When: ${s.when}`);
    lines.push(`Then: ${s.then}`);
    const sats = s.satisfaction.map((sat) => `${sat.kind}: ${sat.value}`).join(', ');
    lines.push(`Satisfactions: [${sats || '(none)'}]`);
    lines.push('');
  }
  return lines.join('\n');
}

export const JUDGE_PARITY_JUDGE: JudgeDef = {
  code: 'review/judge-parity',
  defaultSeverity: 'warning',
  applies(spec: Spec): boolean {
    return spec.scenarios.length > 1;
  },
  buildPrompt(spec: Spec, sliced: SlicedSections) {
    return {
      criterion: CRITERION,
      artifact: renderScenarios(spec),
      line: sliced.headingLines.scenarios,
    };
  },
};
