import { createHash } from 'node:crypto';
import type { Spec } from '@wifo/factory-core';
import type { ReviewCode, ReviewSeverity } from '../findings.js';
import type { SlicedSections } from '../slice-sections.js';
import { CROSS_DOC_CONSISTENCY_JUDGE } from './cross-doc-consistency.js';
import { DOD_PRECISION_JUDGE } from './dod-precision.js';
import { HOLDOUT_DISTINCTNESS_JUDGE } from './holdout-distinctness.js';
import { INTERNAL_CONSISTENCY_JUDGE } from './internal-consistency.js';
import { JUDGE_PARITY_JUDGE } from './judge-parity.js';

export interface JudgeApplicabilityCtx {
  hasTechnicalPlan: boolean;
  hasDod: boolean;
  /**
   * v0.0.7 — number of declared depends-on specs the caller successfully
   * loaded. Defaults to 0 for backward-compat with pre-v0.0.7 callers that
   * only pass hasTechnicalPlan + hasDod.
   */
  depsCount: number;
}

export interface JudgePromptCtx {
  technicalPlan?: string;
  /**
   * v0.0.7 — depends-on specs loaded from disk (caller's responsibility).
   * Each entry is `{ id, body }` where body is the spec's source minus
   * frontmatter. The cross-doc-consistency judge factors these into its
   * artifact.
   */
  deps?: ReadonlyArray<{ id: string; body: string }>;
}

export interface JudgePromptOutput {
  criterion: string;
  artifact: string;
  line?: number;
}

export interface JudgeDef {
  code: ReviewCode;
  defaultSeverity: ReviewSeverity;
  applies(spec: Spec, ctx: JudgeApplicabilityCtx): boolean;
  buildPrompt(spec: Spec, sliced: SlicedSections, ctx: JudgePromptCtx): JudgePromptOutput;
}

// Registry — order is the canonical enable order; new judges appended.
const ALL_JUDGES: JudgeDef[] = [
  INTERNAL_CONSISTENCY_JUDGE,
  JUDGE_PARITY_JUDGE,
  DOD_PRECISION_JUDGE,
  HOLDOUT_DISTINCTNESS_JUDGE,
  CROSS_DOC_CONSISTENCY_JUDGE,
];

export function loadJudgeRegistry(): Record<ReviewCode, JudgeDef> {
  const out = {} as Record<ReviewCode, JudgeDef>;
  for (const j of ALL_JUDGES) out[j.code] = j;
  return out;
}

export function defaultEnabledJudges(): ReviewCode[] {
  return ALL_JUDGES.map((j) => j.code);
}

/**
 * Hash the registry's content so cache entries invalidate when a judge
 * prompt or default severity changes. We probe each judge's static
 * buildPrompt output against a canonical empty Spec stub — the static
 * portions of the criterion are baked into the result, so the hash
 * captures any drift.
 */
export function ruleSetHash(): string {
  const hash = createHash('sha256');
  for (const j of ALL_JUDGES) {
    hash.update(j.code);
    hash.update(':');
    hash.update(j.defaultSeverity);
    hash.update(':');
    // Probe each judge's prompt content with a stub Spec. Spec stub kept
    // minimal but valid for type purposes — the criterion text is what
    // matters for hash invariance.
    const stubSpec: Spec = {
      frontmatter: {
        id: '__stub__',
        classification: 'light',
        type: 'feat',
        status: 'ready',
        exemplars: [],
        'depends-on': [],
      },
      body: '',
      scenarios: [],
      holdouts: [],
      raw: { source: '' },
    };
    const stubSliced: SlicedSections = { headingLines: {} };
    try {
      const p = j.buildPrompt(stubSpec, stubSliced, { technicalPlan: '' });
      hash.update(p.criterion);
    } catch {
      hash.update('(stub-failed)');
    }
    hash.update('|');
  }
  return hash.digest('hex');
}
