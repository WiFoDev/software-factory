import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeDef } from './index.js';

const CRITERION =
  'Every Definition-of-Done check uses an explicit operator. Phrases like ' +
  '"X matches Y" or "X validates Y" are imprecise — does it mean equal, ' +
  'subset, superset, structural-match? Vague set semantics get flagged. ' +
  'Acceptable: "all tests pass", "exit code 0", "X is strictly equal to N", ' +
  '"X contains the string Y", "X has at most N members". Not acceptable: ' +
  '"X matches Y", "X validates Y", "X is correct".';

export const DOD_PRECISION_JUDGE: JudgeDef = {
  code: 'review/dod-precision',
  defaultSeverity: 'warning',
  // Always applies: when the DoD section is missing, runReview emits a
  // `review/section-missing` info finding instead of calling the judge.
  applies(): boolean {
    return true;
  },
  buildPrompt(_spec: Spec, sliced: SlicedSections) {
    return {
      criterion: CRITERION,
      artifact: `## Definition of Done\n${sliced.dod ?? ''}`,
      line: sliced.headingLines.dod,
    };
  },
};
