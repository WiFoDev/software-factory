import { describe, expect, test } from 'bun:test';
import type { Spec, SpecClassification } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import type { JudgeApplicabilityCtx } from './index.js';
import { SCOPE_CREEP_JUDGE } from './scope-creep.js';

function stubSpec(classification: SpecClassification = 'deep', body = '## Spec body'): Spec {
  return {
    frontmatter: {
      id: 'demo',
      classification,
      type: 'feat',
      status: 'ready',
      exemplars: [],
      'depends-on': [],
    },
    body,
    scenarios: [],
    holdouts: [],
    raw: { source: '' },
  };
}

const EMPTY_SLICED: SlicedSections = { headingLines: {} };

describe('scope-creep judge — applies()', () => {
  test('applies returns true on every spec (no preconditions)', () => {
    const ctxs: JudgeApplicabilityCtx[] = [
      { hasTechnicalPlan: false, hasDod: false, depsCount: 0 },
      { hasTechnicalPlan: true, hasDod: true, depsCount: 0 },
      { hasTechnicalPlan: false, hasDod: false, depsCount: 5 },
      { hasTechnicalPlan: true, hasDod: true, depsCount: 2 },
    ];
    for (const ctx of ctxs) {
      expect(SCOPE_CREEP_JUDGE.applies(stubSpec('deep'), ctx)).toBe(true);
      expect(SCOPE_CREEP_JUDGE.applies(stubSpec('light'), ctx)).toBe(true);
    }
  });
});

describe('scope-creep judge — buildPrompt()', () => {
  test('criterion mentions future-version work and anti-goals coverage', () => {
    const out = SCOPE_CREEP_JUDGE.buildPrompt(stubSpec('deep'), EMPTY_SLICED, {});
    const c = out.criterion.toLowerCase();
    expect(c).toContain('future');
    expect(c).toContain('version');
    expect(c).toContain('anti-goal');
    // LIGHT-vs-DEEP awareness referenced in the criterion text.
    expect(c).toContain('light');
    expect(c).toContain('deep');
  });

  test('artifact includes spec classification and Constraints + Subtasks slices', () => {
    const sliced: SlicedSections = {
      constraints: '- v0.0.10 explicitly does NOT ship X',
      subtasks: '- T1 [feature] — Add the foo.',
      headingLines: { constraints: 10, subtasks: 20 },
    };
    const out = SCOPE_CREEP_JUDGE.buildPrompt(stubSpec('deep'), sliced, {});
    expect(out.artifact).toContain('## Spec classification');
    expect(out.artifact).toContain('deep');
    expect(out.artifact).toContain('## Constraints / Decisions');
    expect(out.artifact).toContain('does NOT ship');
    expect(out.artifact).toContain('## Subtasks');
    expect(out.artifact).toContain('T1 [feature]');
  });

  test('artifact reflects light classification when spec is LIGHT', () => {
    const out = SCOPE_CREEP_JUDGE.buildPrompt(stubSpec('light'), EMPTY_SLICED, {});
    expect(out.artifact).toContain('## Spec classification');
    expect(out.artifact).toContain('light');
  });
});
