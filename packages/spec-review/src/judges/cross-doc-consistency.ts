import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeDef } from './index.js';

const CRITERION =
  'The spec and its paired technical-plan agree on every load-bearing ' +
  'detail: the names of error codes mentioned, the public API names ' +
  'enumerated, default values, the deferral / anti-goals list. Any ' +
  'disagreement should be flagged. The principle: a tech-plan that ' +
  "drifts from the spec it claims to implement isn't a tech-plan; it's " +
  'a different proposal.';

const ARTIFACT_CAP_BYTES = 100_000;

function capBytes(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= ARTIFACT_CAP_BYTES) return text;
  // Rough head-only truncation: count chars until we exceed the cap, then
  // append a marker. Reviewer surfaces the truncation in the prompt itself.
  let acc = '';
  for (const char of text) {
    if (Buffer.byteLength(acc + char, 'utf8') > ARTIFACT_CAP_BYTES) break;
    acc += char;
  }
  return `${acc}\n\n[... truncated to fit cap; further content omitted ...]`;
}

export const CROSS_DOC_CONSISTENCY_JUDGE: JudgeDef = {
  code: 'review/cross-doc-consistency',
  defaultSeverity: 'warning',
  applies(_spec: Spec, ctx: { hasTechnicalPlan: boolean }): boolean {
    return ctx.hasTechnicalPlan;
  },
  buildPrompt(spec: Spec, _sliced: SlicedSections, ctx: { technicalPlan?: string }) {
    const plan = ctx.technicalPlan ?? '';
    const artifact = capBytes(`## Spec\n${spec.body}\n\n## Technical Plan\n${plan}`);
    return {
      criterion: CRITERION,
      artifact,
      line: 1,
    };
  },
};
