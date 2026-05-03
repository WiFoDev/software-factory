import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeApplicabilityCtx, JudgeDef, JudgePromptCtx } from './index.js';

const CRITERION =
  'The spec and its paired technical-plan (and any depends-on specs) agree ' +
  'on every load-bearing detail: the names of error codes mentioned, the ' +
  'public API names enumerated, default values, the deferral / anti-goals ' +
  'list. Any disagreement should be flagged. The principle: a tech-plan ' +
  "that drifts from the spec it claims to implement isn't a tech-plan; " +
  "it's a different proposal. A spec that names a depends-on dep should " +
  "use the dep's exported names accurately.";

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
  applies(_spec: Spec, ctx: JudgeApplicabilityCtx): boolean {
    return ctx.hasTechnicalPlan || ctx.depsCount > 0;
  },
  buildPrompt(spec: Spec, _sliced: SlicedSections, ctx: JudgePromptCtx) {
    const sections: string[] = [`## Spec\n${spec.body}`];
    if (typeof ctx.technicalPlan === 'string' && ctx.technicalPlan.length > 0) {
      sections.push(`## Technical Plan\n${ctx.technicalPlan}`);
    }
    if (ctx.deps !== undefined && ctx.deps.length > 0) {
      const depsBody = ctx.deps.map((d) => `### ${d.id}\n${d.body}`).join('\n\n');
      sections.push(`## Deps\n${depsBody}`);
    }
    const artifact = capBytes(sections.join('\n\n'));
    return {
      criterion: CRITERION,
      artifact,
      line: 1,
    };
  },
};
