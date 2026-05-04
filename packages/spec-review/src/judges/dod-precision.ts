import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeDef } from './index.js';

const CRITERION =
  'POSITIVE EXAMPLES — these phrasings ARE precise enough; do NOT flag them. ' +
  'A bullet that pairs a recognizable command name with "green", "clean", ' +
  '"passes", or "succeeds" is a canonical idiom in this toolchain and counts ' +
  'as precise: "tests pass green", "tests green", "<command> tests green", ' +
  '"lint clean", "<command> lint clean", "biome clean", "<command> check ' +
  'clean", "<command> typecheck clean", "<command> typecheck"/"<command> ' +
  'test"/"<command> check"/"<command> build" followed by "green"/"clean"/' +
  '"passes"/"succeeds". The phrase "no errors" or "exit code 0" paired with ' +
  'any allowlisted command is also precise. Allowlisted commands: pnpm, bun, ' +
  'npm, node, tsc, git, npx, bash, sh, make, biome, eslint, prettier, ' +
  'vitest, jest, lint, typecheck, test, check, build. Do NOT emit findings ' +
  'on bullets that match these patterns.\n\n' +
  'Every other Definition-of-Done check must use an explicit operator. ' +
  'Phrases like "X matches Y" or "X validates Y" are imprecise — does it ' +
  'mean equal, subset, superset, structural-match? Vague set semantics get ' +
  'flagged. Acceptable: "all tests pass", "exit code 0", "X is strictly ' +
  'equal to N", "X contains the string Y", "X has at most N members". Not ' +
  'acceptable: "X matches Y", "X validates Y", "X is correct".';

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
