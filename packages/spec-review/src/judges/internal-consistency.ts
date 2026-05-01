import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeDef } from './index.js';

const CRITERION =
  'The spec is internally consistent: every constraint references a real ' +
  'dep declared elsewhere in the same spec; every scenario references a ' +
  'test path inside the implied cwd; every Definition-of-Done check ' +
  'matches one of the constraints. Be strict — if a constraint mentions ' +
  '"foo" but no subtask, scenario, or DoD entry references "foo", flag it.';

export const INTERNAL_CONSISTENCY_JUDGE: JudgeDef = {
  code: 'review/internal-consistency',
  defaultSeverity: 'warning',
  applies(): boolean {
    return true;
  },
  buildPrompt(spec: Spec, sliced: SlicedSections) {
    const parts: string[] = [];
    if (sliced.intent) parts.push(`## Intent\n${sliced.intent}`);
    if (sliced.constraints) parts.push(`## Constraints / Decisions\n${sliced.constraints}`);
    if (sliced.subtasks) parts.push(`## Subtasks\n${sliced.subtasks}`);
    if (sliced.dod) parts.push(`## Definition of Done\n${sliced.dod}`);
    if (sliced.scenarios) parts.push(`## Scenarios\n${sliced.scenarios}`);
    return {
      criterion: CRITERION,
      artifact: parts.join('\n\n') || spec.body,
      line: sliced.headingLines.constraints,
    };
  },
};
