import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeDef } from './index.js';

const CRITERION =
  'The spec stays in its declared version scope. Two failure modes:\n' +
  '  (1) future-version mentions: a subtask references work tagged for a ' +
  'later version (e.g., "ship X in v0.0.11" or "deferred to vN+1"). Such ' +
  'work belongs in a separate spec for that release — flag the offending ' +
  'subtask by name.\n' +
  '  (2) missing anti-goals: a DEEP spec lacks an explicit "vX.Y.Z does ' +
  'NOT ship" or "Deferred per Constraints" line in its `## Constraints / ' +
  'Decisions` block. DEEP specs are scoped large enough that what they DO ' +
  'NOT ship matters; LIGHT specs are small and focused enough that ' +
  'omitting an anti-goals block is fine. For LIGHT specs, do NOT flag ' +
  'missing anti-goals; only flag future-version mentions.\n' +
  'The principle: scope-creep is the most common spec-quality regression — ' +
  'catch it at review time, not implementation time.';

export const SCOPE_CREEP_JUDGE: JudgeDef = {
  code: 'review/scope-creep',
  defaultSeverity: 'warning',
  applies(): boolean {
    return true;
  },
  buildPrompt(spec: Spec, sliced: SlicedSections) {
    const parts: string[] = [];
    parts.push(`## Spec classification\n${spec.frontmatter.classification}`);
    if (sliced.constraints) {
      parts.push(`## Constraints / Decisions\n${sliced.constraints}`);
    }
    if (sliced.subtasks) {
      parts.push(`## Subtasks\n${sliced.subtasks}`);
    }
    return {
      criterion: CRITERION,
      artifact: parts.join('\n\n'),
      line: sliced.headingLines.constraints ?? sliced.headingLines.subtasks,
    };
  },
};
