import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeDef } from './index.js';

const CRITERION =
  'Subtask LOC estimates are realistic given the file count each subtask ' +
  'references. Real edits cluster around 15-30 LOC per file; substantially ' +
  'lower ratios suggest under-scoping (the estimate counts a few canonical ' +
  'lines and ignores boilerplate); substantially higher ratios suggest the ' +
  'estimate bundles work that should be split. For each subtask with a LOC ' +
  'estimate, count distinct file paths in its bullet body and compute the ' +
  'LOC-vs-path-count ratio. Flag any subtask whose ratio looks off — name ' +
  'the subtask, its estimate, the file count, and suggest re-estimating or ' +
  "splitting. The principle: a subtask whose estimate doesn't match its " +
  'breadth is unlikely to land in the LOC budget claimed.';

const LOC_REGEX = /~?\d+\s*LOC/i;

export const FEASIBILITY_JUDGE: JudgeDef = {
  code: 'review/feasibility',
  defaultSeverity: 'warning',
  applies(_spec: Spec): boolean {
    // Applicability is computed against the spec's Subtasks section. The
    // section may be absent (in which case the judge has nothing to score),
    // OR present without LOC estimates (also nothing to score). Both cases
    // decline. We can't read sliced sections from `applies`, so we walk the
    // body directly here.
    const body = _spec.body;
    if (!body) return false;
    // Find the Subtasks section by simple `## Subtasks` heading walk.
    const lines = body.split('\n');
    let inSubtasks = false;
    let inFence = false;
    for (const line of lines) {
      if (line.startsWith('```')) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (line.startsWith('## ')) {
        inSubtasks = line.replace(/\s+$/, '') === '## Subtasks';
        continue;
      }
      if (inSubtasks && LOC_REGEX.test(line)) return true;
    }
    return false;
  },
  buildPrompt(_spec: Spec, sliced: SlicedSections) {
    return {
      criterion: CRITERION,
      artifact: `## Subtasks\n${sliced.subtasks ?? ''}`,
      line: sliced.headingLines.subtasks,
    };
  },
};
