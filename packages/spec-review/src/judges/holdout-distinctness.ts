import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeDef } from './index.js';

const CRITERION =
  'Holdout scenarios probe failure categories that are genuinely distinct ' +
  'from the visible scenarios. Two failure modes:\n' +
  '  (1) overlap: a holdout paraphrases a visible scenario — overfit risk.\n' +
  '  (2) irrelevance: a holdout probes a concern that has nothing to do ' +
  "with the spec's surface — wasted effort.\n" +
  'Both should be flagged. The principle: holdouts catch what visible ' +
  'scenarios miss, but only along axes the spec actually covers.';

function renderScenarios(spec: Spec): string {
  const visible = spec.scenarios
    .map(
      (s) =>
        `[VISIBLE ${s.id}] ${s.name}\n  Given: ${s.given}\n  When: ${s.when}\n  Then: ${s.then}`,
    )
    .join('\n\n');
  const holdouts = spec.holdouts
    .map(
      (s) =>
        `[HOLDOUT ${s.id}] ${s.name}\n  Given: ${s.given}\n  When: ${s.when}\n  Then: ${s.then}`,
    )
    .join('\n\n');
  return `## Visible scenarios\n${visible}\n\n## Holdout scenarios\n${holdouts}`;
}

export const HOLDOUT_DISTINCTNESS_JUDGE: JudgeDef = {
  code: 'review/holdout-distinctness',
  defaultSeverity: 'warning',
  applies(spec: Spec): boolean {
    return spec.holdouts.length > 0;
  },
  buildPrompt(spec: Spec, sliced: SlicedSections) {
    return {
      criterion: CRITERION,
      artifact: renderScenarios(spec),
      line: sliced.headingLines.holdouts ?? sliced.headingLines.scenarios,
    };
  },
};
