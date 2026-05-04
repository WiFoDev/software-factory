import { type Spec, findSection } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeApplicabilityCtx, JudgeDef, JudgePromptCtx } from './index.js';

const CRITERION =
  'The spec and its paired technical-plan agree on the public API surface: ' +
  "every function, type, error code, or constant named in the spec's " +
  "`## Constraints / Decisions` block is enumerated in the technical-plan's " +
  '§4 `Public API surface deltas` section, and vice versa. Any name divergence ' +
  'between the two — a name in Constraints but not in §4, or in §4 but not ' +
  'in Constraints — should be flagged by name. The principle: a tech-plan ' +
  "that drops a name the spec promised, or invents one the spec didn't, " +
  'is not yet ratified. Names declared in any depends-on parent count as ' +
  'available context.';

const ARTIFACT_CAP_BYTES = 100_000;

function capBytes(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= ARTIFACT_CAP_BYTES) return text;
  let acc = '';
  for (const char of text) {
    if (Buffer.byteLength(acc + char, 'utf8') > ARTIFACT_CAP_BYTES) break;
    acc += char;
  }
  return `${acc}\n\n[... truncated to fit cap; further content omitted ...]`;
}

export const API_SURFACE_DRIFT_JUDGE: JudgeDef = {
  code: 'review/api-surface-drift',
  defaultSeverity: 'warning',
  applies(_spec: Spec, ctx: JudgeApplicabilityCtx): boolean {
    return ctx.hasTechnicalPlan;
  },
  buildPrompt(_spec: Spec, sliced: SlicedSections, ctx: JudgePromptCtx) {
    const parts: string[] = [];
    if (sliced.constraints) {
      parts.push(`## Spec — Constraints / Decisions\n${sliced.constraints}`);
    }
    if (typeof ctx.technicalPlan === 'string' && ctx.technicalPlan.length > 0) {
      const surface = findSection(ctx.technicalPlan, '4. Public API surface deltas');
      if (surface !== null) {
        const body = surface.lines.join('\n').trim();
        parts.push(`## Technical Plan — §4. Public API surface deltas\n${body}`);
      } else {
        parts.push(`## Technical Plan\n${ctx.technicalPlan}`);
      }
    }
    if (ctx.deps !== undefined && ctx.deps.length > 0) {
      const depEntries = ctx.deps.map((d) => {
        const section = findSection(d.body, 'Constraints / Decisions');
        const constraints = section ? section.lines.join('\n').trim() : '';
        if (constraints.length === 0) {
          return `### ${d.id}\n(no constraints section in this dep)`;
        }
        return `### ${d.id}\n${constraints}`;
      });
      parts.push(`## Deps Constraints (referenced via depends-on)\n${depEntries.join('\n\n')}`);
    }
    const artifact = capBytes(parts.join('\n\n'));
    return {
      criterion: CRITERION,
      artifact,
      line: sliced.headingLines.constraints,
    };
  },
};
