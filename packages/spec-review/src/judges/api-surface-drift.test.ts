import { describe, expect, test } from 'bun:test';
import type { Spec } from '@wifo/factory-core';
import type { SlicedSections } from '../slice-sections.js';
import { API_SURFACE_DRIFT_JUDGE } from './api-surface-drift.js';
import type { JudgeApplicabilityCtx, JudgePromptCtx } from './index.js';

function stubSpec(body = '## Spec body'): Spec {
  return {
    frontmatter: {
      id: 'demo',
      classification: 'deep',
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

describe('api-surface-drift judge — applies()', () => {
  test('applies returns true when paired technical-plan present', () => {
    const ctx: JudgeApplicabilityCtx = {
      hasTechnicalPlan: true,
      hasDod: true,
      depsCount: 0,
    };
    expect(API_SURFACE_DRIFT_JUDGE.applies(stubSpec(), ctx)).toBe(true);
  });

  test('applies returns false when no technical-plan', () => {
    const ctx: JudgeApplicabilityCtx = {
      hasTechnicalPlan: false,
      hasDod: true,
      depsCount: 2,
    };
    expect(API_SURFACE_DRIFT_JUDGE.applies(stubSpec(), ctx)).toBe(false);
  });
});

describe('api-surface-drift judge — buildPrompt()', () => {
  test('criterion mentions name divergence between spec Constraints and tech-plan §4', () => {
    const sliced: SlicedSections = {
      constraints: '- exports: `myFunction`, `MyType`',
      headingLines: { constraints: 10 },
    };
    const ctx: JudgePromptCtx = {
      technicalPlan:
        '# tech plan\n\n## 4. Public API surface deltas\n\n- new export: `myFunction(x: string)`\n',
    };
    const out = API_SURFACE_DRIFT_JUDGE.buildPrompt(stubSpec(), sliced, ctx);
    expect(out.criterion.toLowerCase()).toContain('public api surface');
    expect(out.criterion).toContain('Constraints');
    expect(out.criterion).toContain('§4');
    expect(out.criterion.toLowerCase()).toContain('divergence');
  });

  test('artifact slices spec Constraints and tech-plan §4 section when both present', () => {
    const sliced: SlicedSections = {
      constraints: '- exports: `myFunction`, `MyType`',
      headingLines: { constraints: 10 },
    };
    const ctx: JudgePromptCtx = {
      technicalPlan:
        '# tech plan\n\n## 1. Intro\n\nintro text\n\n## 4. Public API surface deltas\n\n- new export: `myFunction(x: string)`\n\n## 5. Risks\n\nrisk text\n',
    };
    const out = API_SURFACE_DRIFT_JUDGE.buildPrompt(stubSpec(), sliced, ctx);
    expect(out.artifact).toContain('## Spec — Constraints / Decisions');
    expect(out.artifact).toContain('myFunction');
    expect(out.artifact).toContain('MyType');
    expect(out.artifact).toContain('§4. Public API surface deltas');
    expect(out.artifact).toContain('new export: `myFunction(x: string)`');
    expect(out.artifact).not.toContain('intro text');
    expect(out.artifact).not.toContain('risk text');
  });
});
