import { type Spec, findSection } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeDef, JudgePromptCtx } from './index.js';

const CRITERION =
  'The spec is internally consistent: every constraint references a real ' +
  'dep declared elsewhere in the same spec; every scenario references a ' +
  'test path inside the implied cwd; every Definition-of-Done check ' +
  'matches one of the constraints. Be strict — if a constraint mentions ' +
  '"foo" but no subtask, scenario, or DoD entry references "foo", flag it. ' +
  'Constraints declared in any depends-on parent count as available context — ' +
  "references to them in this spec's scenarios do NOT need to be locally " +
  "declared. Score against the union of this spec's Constraints + every " +
  "dep's Constraints reachable via depends-on.";

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

export const INTERNAL_CONSISTENCY_JUDGE: JudgeDef = {
  code: 'review/internal-consistency',
  defaultSeverity: 'warning',
  applies(): boolean {
    return true;
  },
  buildPrompt(spec: Spec, sliced: SlicedSections, ctx: JudgePromptCtx) {
    const parts: string[] = [];
    if (sliced.intent) parts.push(`## Intent\n${sliced.intent}`);
    if (sliced.constraints) parts.push(`## Constraints / Decisions\n${sliced.constraints}`);
    if (sliced.subtasks) parts.push(`## Subtasks\n${sliced.subtasks}`);
    if (sliced.dod) parts.push(`## Definition of Done\n${sliced.dod}`);
    if (sliced.scenarios) parts.push(`## Scenarios\n${sliced.scenarios}`);
    let artifact = parts.join('\n\n') || spec.body;
    if (ctx.deps !== undefined && ctx.deps.length > 0) {
      const depEntries = ctx.deps.map((d) => {
        const section = findSection(d.body, 'Constraints / Decisions');
        if (section === null) {
          return `### ${d.id}\n(no constraints section in this dep)`;
        }
        const constraints = section.lines.join('\n').trim();
        if (constraints.length === 0) {
          return `### ${d.id}\n(no constraints section in this dep)`;
        }
        return `### ${d.id}\n${constraints}`;
      });
      artifact = `${artifact}\n\n## Deps Constraints (referenced via depends-on)\n${depEntries.join('\n\n')}`;
    }
    return {
      criterion: CRITERION,
      artifact: capBytes(artifact),
      line: sliced.headingLines.constraints,
    };
  },
};
